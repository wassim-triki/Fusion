// Response headers the shell's /api proxy passes back to the browser.

const STRIPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-encoding",
  "content-length",
]);

export function buildResponseHeaders(upstream: Response): Headers {
  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (!STRIPPED_RESPONSE_HEADERS.has(name) && name !== "set-cookie") {
      headers.set(key, value);
    }
  });
  // Every cookie the upstream sets reaches the browser; `set` would keep only the last (B-191).
  for (const cookie of upstream.headers.getSetCookie()) {
    headers.append("set-cookie", cookie);
  }
  return headers;
}
