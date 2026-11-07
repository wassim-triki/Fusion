import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildResponseHeaders } from "@/lib/proxy-headers";

// The shell owns the single `/api/*` choke point in front of the Gateway. It was
// an implicit Next rewrite that, when the Gateway was unreachable, surfaced a bare
// unattributed 500 the UI could not tell from an application crash. This explicit
// proxy preserves full pass-through fidelity for successful traffic and attributes
// an unreachable/unavailable upstream as a typed 503 the client can classify.
//
// Node runtime + dynamic: streaming request/response bodies (uploads, downloads)
// need the Node runtime, and no response here may be cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GATEWAY_URL = process.env.GATEWAY_URL || "http://localhost:5000";

// Machine-readable attribution the client maps to the "upstream-unavailable" class
// (mirrors @repo/api UPSTREAM_UNAVAILABLE_CODE / _STATUS). Kept inline so the shell
// carries no app dependency, but the string contract is shared.
const UPSTREAM_UNAVAILABLE_STATUS = 503;
const UPSTREAM_UNAVAILABLE_CODE = "upstream_unavailable";

// Hop-by-hop and length/encoding headers are per-connection: forwarding them
// corrupts the proxied message (fetch recomputes length and decodes the body).
const STRIPPED_REQUEST_HEADERS = new Set(["host", "connection", "content-length"]);
// Who the caller is comes from the shell, never from the caller: X-Forwarded-For carries the one address
// `instrumentation.ts` stamped from the socket, and other ways of claiming an address are dropped.
const CLIENT_ADDRESS_HEADERS = new Set(["forwarded", "x-forwarded-for", "x-real-ip"]);
function buildUpstreamUrl(request: NextRequest): string {
  // Preserve the full path after the shell origin and the exact query string.
  const { pathname, search } = request.nextUrl;
  return `${GATEWAY_URL}${pathname}${search}`;
}

function forwardRequestHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (!STRIPPED_REQUEST_HEADERS.has(name) && !CLIENT_ADDRESS_HEADERS.has(name)) {
      headers.set(key, value);
    }
  });
  const client = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  if (client) headers.set("x-forwarded-for", client);
  return headers;
}

// Connection-level failures that are commonly transient (a stale pooled socket
// the upstream already closed, or a reset/timeout under momentary load) and are
// worth one retry against an otherwise-healthy upstream. A genuine ECONNREFUSED
// (upstream truly down) also matches and simply fails fast a second time.
const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);

// The client (browser) went away mid-request — navigated, cancelled, or the tab
// closed. Next/undici surface this as `ResponseAborted` or an `AbortError`, and
// the incoming request's signal is aborted. It must never be treated as an
// upstream failure: the caller is gone, so there is nothing to retry or attribute.
function isClientAbort(error: unknown, request: NextRequest): boolean {
  if (request.signal?.aborted) return true;
  if (error instanceof DOMException && error.name === "AbortError") return true;
  const name = (error as { name?: string })?.name;
  const code =
    (error as { code?: string })?.code ??
    (error as { cause?: { code?: string } })?.cause?.code;
  return (
    name === "AbortError" ||
    name === "ResponseAborted" ||
    code === "ABORT_ERR" ||
    code === "UND_ERR_ABORTED"
  );
}

function isTransientConnectionError(error: unknown): boolean {
  const code =
    (error as { code?: string })?.code ??
    (error as { cause?: { code?: string } })?.cause?.code;
  if (code && TRANSIENT_CODES.has(code)) return true;
  // undici surfaces resets as a generic TypeError("fetch failed") with the real
  // cause nested; treat a fetch-failed/socket-hang-up as transient too.
  const msg = error instanceof Error ? error.message : "";
  return /fetch failed|socket hang up|other side closed|terminated/i.test(msg);
}

function upstreamUnavailableResponse(): NextResponse {
  // The @repo/api envelope shape, so the client's ApiError path reads a real code
  // instead of an empty-bodied generic 500.
  return NextResponse.json(
    {
      data: null,
      isSuccess: false,
      code: UPSTREAM_UNAVAILABLE_CODE,
      errors: ["The service is temporarily unavailable. Please try again."],
    },
    { status: UPSTREAM_UNAVAILABLE_STATUS },
  );
}

async function proxy(request: NextRequest): Promise<Response> {
  const method = request.method;
  const hasBody = method !== "GET" && method !== "HEAD";

  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers: forwardRequestHeaders(request),
    // Stream the request body through unbuffered so multipart/binary/large uploads
    // are not materialized in memory; `duplex: "half"` is required to send a stream.
    body: hasBody ? request.body : undefined,
    duplex: hasBody ? "half" : undefined,
    // Propagate client cancellation to the upstream request.
    signal: request.signal,
    redirect: "manual",
    cache: "no-store",
  };

  const url = buildUpstreamUrl(request);
  // A bodyless request can be retried once: its stream is never consumed, so a
  // transient connection blip (a stale keep-alive socket the upstream already
  // closed, or a reset while the dev event loop is briefly starved during a cold
  // compile) does not have to surface as a hard failure against a healthy Gateway.
  // A request WITH a body must not be replayed — the ReadableStream is single-use —
  // so it fails on the first attempt.
  const maxAttempts = hasBody ? 1 : 2;

  let upstream: Response | null = null;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      upstream = await fetch(url, init);
      break;
    } catch (error) {
      // The client navigated away / disconnected mid-request. This is NOT an
      // upstream failure — the caller is gone, so never retry it and never
      // attribute it as a 503. Let it terminate as an aborted request would
      // natively. (Next/undici throw `ResponseAborted`/`AbortError` here, and the
      // request signal is aborted — checking the name alone missed the former.)
      if (isClientAbort(error, request)) {
        throw error;
      }
      lastError = error;
      // Retry only a transient connection-level failure, and only if attempts
      // remain. A short backoff lets the second attempt land after a momentary
      // blip (a stale socket, or the dev event loop briefly starved by a cold
      // compile) instead of firing again inside the same bad window.
      if (attempt < maxAttempts && isTransientConnectionError(error)) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      break;
    }
  }

  if (!upstream) {
    // Exhausted attempts: the upstream could not be reached (ECONNREFUSED, DNS,
    // TLS, timeout, or a reset that survived the retry). Attribute it distinctly
    // rather than as a bare 500.
    if (process.env.NODE_ENV !== "production") {
      const e = lastError as { name?: string; message?: string; code?: string; cause?: { name?: string; message?: string; code?: string } };
      console.warn(
        `[shell/api] Upstream unreachable at ${GATEWAY_URL} for ${request.method} ${request.nextUrl.pathname} after ${maxAttempts} attempt(s) — returning attributed 503. detail=` +
          JSON.stringify({ name: e?.name, message: e?.message, code: e?.code, causeName: e?.cause?.name, causeMessage: e?.cause?.message, causeCode: e?.cause?.code }),
      );
    }
    return upstreamUnavailableResponse();
  }

  // A reachable Gateway that itself reports the backend unavailable is the same
  // class to the user; keep its body/headers but ensure the class is legible.
  // (502/503/504 already classify as upstream-unavailable client-side.)

  // Stream the upstream response back verbatim: status (incl. 204), headers
  // (content-type, content-disposition, ETag, concurrency), and body/stream.
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: buildResponseHeaders(upstream),
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
