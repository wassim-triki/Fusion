import { LOCALE_COOKIE, isLocale } from "@repo/i18n/config";
import { createApiClient } from "./client";
import { ApiError } from "./types";
import type {
  ApiClient,
  ApiError as ApiErrorType,
  RequestOptions,
} from "./types";

declare const process: { env?: Record<string, string | undefined> } | undefined;

/**
 * Returns true when running in a browser context.
 *
 * Used internally to guard browser-only APIs (localStorage, window).
 * On the server (Node/Edge) this returns false, keeping every import SSR-safe.
 */
export function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

const AUTH_STORAGE_KEY = "ey_hr_auth";
/** The administrator's own session, kept aside while they see Fusion as someone. */
const HOME_STORAGE_KEY = "ey_hr_auth_home";
const AUTH_COOKIE_NAME = "ey_hr_authenticated";
const AUTH_STORAGE_EVENT = "ey_hr_auth:changed";
const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60_000;

/** What the browser knows about a view of Fusion as someone: who, their roles, and where to go back to. */
export interface ViewAsMarker {
  sessionId: string;
  viewerName: string;
  personName: string;
  /** The person's role names, as the bar shows them. */
  roles: string[];
  /** Where "Back" returns (the role page the view started from). */
  returnTo: string;
  expiresAt: string;
}

interface BrowserStoredAuth {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiration: string;
  /** Present while seeing Fusion as someone: this session is theirs, read-only, with no refresh token. */
  viewAs?: ViewAsMarker;
  user: {
    userId: string;
    tenantId: string | null;
    tenantMembershipId: string | null;
    moduleEntitlements: string[];
    email: string;
    fullName: string;
    roles: string[];
    employeeId?: string | null;
    language?: string;
    accessProfiles?: Array<{
      id: string;
      name: string;
      type: string;
      isSystemProtected: boolean;
    }>;
    effectivePermissions?: Array<{
      permissionKey: string;
      scope: string;
      label: string;
      group: string;
      helperText: string | null;
      allowedScopes: string[];
    }>;
  };
}

export interface RefreshResponse {
  userId: string;
  tenantId: string | null;
  tenantMembershipId: string | null;
  moduleEntitlements: string[];
  email: string;
  fullName: string;
  roles: string[];
  employeeId?: string | null;
  language?: string;
  accessProfiles?: Array<{
    id: string;
    name: string;
    type: string;
    isSystemProtected: boolean;
  }>;
  effectivePermissions?: Array<{
    permissionKey: string;
    scope: string;
    label: string;
    group: string;
    helperText: string | null;
    allowedScopes: string[];
  }>;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiration: string;
}

interface RefreshEnvelope {
  data: RefreshResponse | null;
  errors: string[];
  isSuccess: boolean;
}

let refreshPromise: Promise<string | null> | null = null;

function dispatchAuthStorageChanged(): void {
  if (!isBrowser() || typeof window.dispatchEvent !== "function") {
    return;
  }

  window.dispatchEvent(new CustomEvent(AUTH_STORAGE_EVENT));
}

function persistBrowserAuth(auth: RefreshResponse, viewAs?: ViewAsMarker): void {
  if (!isBrowser()) {
    return;
  }

  const storedAuth: BrowserStoredAuth = {
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    accessTokenExpiration: auth.accessTokenExpiration,
    ...(viewAs ? { viewAs } : {}),
    user: {
      userId: auth.userId,
      tenantId: auth.tenantId ?? null,
      tenantMembershipId: auth.tenantMembershipId ?? null,
      moduleEntitlements: auth.moduleEntitlements ?? [],
      email: auth.email,
      fullName: auth.fullName,
      roles: auth.roles,
      employeeId: auth.employeeId ?? null,
      language: auth.language,
      accessProfiles: auth.accessProfiles ?? [],
      effectivePermissions: auth.effectivePermissions ?? [],
    },
  };

  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(storedAuth));
  document.cookie = `${AUTH_COOKIE_NAME}=true; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`;
  persistLanguageCookie(auth.language);
  dispatchAuthStorageChanged();
}

/**
 * Writes the person's language, as Identity resolved it, into the cookie every app's next-intl config reads.
 * A missing or unsupported value leaves the cookie alone. Signing out keeps it, so the sign-in page stays in the
 * last language.
 */
export function persistLanguageCookie(
  language: string | null | undefined
): void {
  if (!isBrowser() || !isLocale(language)) {
    return;
  }

  document.cookie = `${LOCALE_COOKIE}=${language}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

/** The language the person reads Fusion in, from the cookie their session writes; null on the server or before sign-in. */
export function readLanguageCookie(): string | null {
  if (!isBrowser()) {
    return null;
  }

  const value = (typeof document.cookie === "string" ? document.cookie : "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LOCALE_COOKIE}=`))
    ?.slice(LOCALE_COOKIE.length + 1);
  return isLocale(value) ? value : null;
}

/**
 * Opens a server-sent event stream through the shell's `/api` with the browser session's token and language.
 * `EventSource` can't send an `Authorization` header, so streams are read with `fetch`.
 */
export async function openPlatformEventStream(
  path: string,
  signal: AbortSignal
): Promise<Response> {
  const baseUrl = "/api";
  const headers: Record<string, string> = { Accept: "text/event-stream" };
  const token = await getBrowserAccessToken(baseUrl);
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const language = readLanguageCookie();
  if (language) {
    headers["Accept-Language"] = language;
  }
  return fetch(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`, {
    headers,
    signal,
    cache: "no-store",
    credentials: "same-origin",
  });
}

function clearBrowserAuth(): void {
  if (!isBrowser()) {
    return;
  }

  localStorage.removeItem(AUTH_STORAGE_KEY);
  document.cookie = `${AUTH_COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
  dispatchAuthStorageChanged();
}

function loadBrowserAuth(): BrowserStoredAuth | null {
  if (!isBrowser()) {
    return null;
  }

  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    return JSON.parse(raw) as BrowserStoredAuth;
  } catch {
    return null;
  }
}

/** The view of Fusion as someone this browser is in, or null. */
export function readViewAs(): ViewAsMarker | null {
  return loadBrowserAuth()?.viewAs ?? null;
}

/**
 * Starts seeing Fusion as someone: the administrator's session goes aside and the person's read-only session (from
 * `POST /identity/view-as`) becomes this browser's. The caller then navigates, so every app loads as them.
 */
export function beginViewAs(session: RefreshResponse, marker: ViewAsMarker): void {
  if (!isBrowser()) {
    return;
  }

  const home = localStorage.getItem(AUTH_STORAGE_KEY);
  // Never nest: a view started from a view would put the person's session aside as "home".
  if (!home || (JSON.parse(home) as BrowserStoredAuth).viewAs) {
    return;
  }

  localStorage.setItem(HOME_STORAGE_KEY, home);
  persistBrowserAuth(session, marker);
}

/**
 * Brings the administrator's own session back and returns where to go (the view's starting page), or null when this
 * browser wasn't seeing anyone. Used by "Back", and on its own when the view ends or expires.
 */
export function finishViewAs(): string | null {
  if (!isBrowser()) {
    return null;
  }

  const viewing = loadBrowserAuth()?.viewAs ?? null;
  const home = localStorage.getItem(HOME_STORAGE_KEY);
  localStorage.removeItem(HOME_STORAGE_KEY);
  if (!viewing) {
    return null;
  }

  if (home) {
    localStorage.setItem(AUTH_STORAGE_KEY, home);
    dispatchAuthStorageChanged();
  } else {
    clearBrowserAuth();
  }

  return viewing.returnTo;
}

function isAccessTokenUsable(accessTokenExpiration: string): boolean {
  return (
    new Date(accessTokenExpiration).getTime() >
    Date.now() + ACCESS_TOKEN_REFRESH_BUFFER_MS
  );
}

async function requestSessionRefresh(baseUrl: string): Promise<string | null> {
  const stored = loadBrowserAuth();

  // A view has no refresh token: when it ends or expires the administrator comes back where they started, rather
  // than being signed out.
  if (stored?.viewAs) {
    const returnTo = finishViewAs();
    if (returnTo && isBrowser()) {
      window.location.assign(returnTo);
    }
    return null;
  }

  if (!stored?.refreshToken) {
    clearBrowserAuth();
    return null;
  }

  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const response = await fetch(`${normalizedBase}/identity/auth/refresh`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refreshToken: stored.refreshToken }),
    credentials: "same-origin",
    cache: "no-store",
  });

  if (!response.ok) {
    if (
      response.status === 400 ||
      response.status === 401 ||
      response.status === 403
    ) {
      clearBrowserAuth();
      return null;
    }

    return stored.accessToken;
  }

  let payload: RefreshEnvelope;
  try {
    payload = (await response.json()) as RefreshEnvelope;
  } catch {
    return stored.accessToken;
  }

  if (!payload.isSuccess || !payload.data) {
    clearBrowserAuth();
    return null;
  }

  persistBrowserAuth(payload.data);
  return payload.data.accessToken;
}

async function getBrowserAccessToken(baseUrl: string): Promise<string | null> {
  const stored = loadBrowserAuth();
  if (!stored) {
    return null;
  }

  if (isAccessTokenUsable(stored.accessTokenExpiration)) {
    return stored.accessToken;
  }

  if (!refreshPromise) {
    refreshPromise = requestSessionRefresh(baseUrl).finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

export interface PlatformApiClientConfig {
  /**
   * Override the base URL.
   *
   * Resolution order:
   *  1. Explicit `baseUrl` arg
   *  2. `NEXT_PUBLIC_API_BASE_URL` env var   (set this for SSR to reach the gateway directly)
   *  3. `"/api"`                             (works client-side via Shell proxy rewrites)
   *
   * **SSR note:** Relative `/api` only works in the browser because the Shell
   * dev-server rewrites it to the gateway. Server-side renders have no such
   * proxy, so set `NEXT_PUBLIC_API_BASE_URL=http://localhost:5000/api` (or your
   * gateway URL) when you need SSR fetches to reach the backend.
   */
  baseUrl?: string;
  /**
   * Token retrieval function.
   *
   * Default: reads `accessToken` from the `ey_hr_auth` localStorage entry
   * persisted by `@repo/auth` (browser-only).
   * On the server the default returns `null` — requests proceed without auth.
   *
   * If you need authenticated SSR in the future (e.g. cookie-based auth),
   * provide a custom `getToken` that reads from the request context.
   */
  getToken?: () => string | null;
  /**
   * Optional explicit tenant ID callback for an authorized tenant-scoped
   * workflow. When set and returns a non-null value, the client attaches the
   * `X-Tenant-Id` header to every request.
   */
  getTenantId?: () => string | null;
  /**
   * Called once when the server responds with 401 Unauthorized.
   *
   * Fires at most once per client instance to prevent redirect loops.
   * The `ApiError` is still thrown after this callback runs — callers
   * can catch and handle it normally.
   */
  onAuthError?: (error: ApiError) => void;
}

/**
 * Create a pre-configured API client for the EY HR Platform.
 *
 * **Browser:** uses Shell proxy (`/api`) + localStorage token.
 * **Server:**  uses `NEXT_PUBLIC_API_BASE_URL` (must be absolute) + no auth.
 *
 * SSR-safe: never touches `window` or `localStorage` on the server.
 */
export function createPlatformApiClient(
  config: PlatformApiClientConfig = {}
): ApiClient {
  const baseUrl =
    config.baseUrl ??
    (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_BASE_URL
      ? process.env.NEXT_PUBLIC_API_BASE_URL!
      : "/api");

  const usesBrowserSessionRefresh = !config.getToken && isBrowser();
  const getToken = config.getToken ?? (() => getBrowserAccessToken(baseUrl));
  const getTenantId = config.getTenantId;

  const client = createApiClient({
    baseUrl,
    getToken,
    getTenantId,
    getLanguage: readLanguageCookie,
  });

  let authErrorFired = false;

  const handleAuthError = (error: unknown): never => {
    if (
      error instanceof ApiError &&
      error.status === 401 &&
      config.onAuthError &&
      !authErrorFired
    ) {
      authErrorFired = true;
      try {
        config.onAuthError(error as ApiErrorType);
      } catch {
        // Callback failures must not mask the original auth error.
      }
    }

    throw error;
  };

  const executeWithRefreshRetry = async <T>(
    execute: () => Promise<T>,
    options?: RequestOptions
  ): Promise<T> => {
    try {
      return await execute();
    } catch (error) {
      if (
        !usesBrowserSessionRefresh ||
        options?.skipAuth ||
        !(error instanceof ApiError) ||
        error.status !== 401
      ) {
        return handleAuthError(error);
      }

      const refreshedToken = await requestSessionRefresh(baseUrl);
      if (!refreshedToken) {
        return handleAuthError(error);
      }

      try {
        return await execute();
      } catch (retryError) {
        return handleAuthError(retryError);
      }
    }
  };

  return {
    get<T>(path: string, options?: RequestOptions): Promise<T> {
      return executeWithRefreshRetry(
        () => client.get<T>(path, options),
        options
      );
    },

    post<T>(
      path: string,
      body?: unknown,
      options?: RequestOptions
    ): Promise<T> {
      return executeWithRefreshRetry(
        () => client.post<T>(path, body, options),
        options
      );
    },

    put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
      return executeWithRefreshRetry(
        () => client.put<T>(path, body, options),
        options
      );
    },

    patch<T>(
      path: string,
      body?: unknown,
      options?: RequestOptions
    ): Promise<T> {
      return executeWithRefreshRetry(
        () => client.patch<T>(path, body, options),
        options
      );
    },

    delete<T>(path: string, options?: RequestOptions): Promise<T> {
      return executeWithRefreshRetry(
        () => client.delete<T>(path, options),
        options
      );
    },
  };
}
