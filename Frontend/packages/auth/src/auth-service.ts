import { clearSessionExpired, createPlatformApiClient, persistLanguageCookie } from "@repo/api";
import type {
  LoginRequest,
  RegisterRequest,
  RefreshTokenRequest,
  AuthResponse,
  StoredAuth,
} from "./types";

// ── API client ────────────────────────────────────────────────────────
const client = createPlatformApiClient();

const AUTH = "/identity/auth";
export const AUTH_STORAGE_EVENT = "ey_hr_auth:changed";

// ── Public API ───────────────────────────────────────────────────────
// Resolves with the unwrapped AuthResponse on success; throws ApiError on failure.

export async function login(request: LoginRequest): Promise<AuthResponse> {
  return client.post<AuthResponse>(`${AUTH}/login`, request, { skipAuth: true });
}

export async function register(request: RegisterRequest): Promise<AuthResponse> {
  return client.post<AuthResponse>(`${AUTH}/register`, request, { skipAuth: true });
}

export async function refreshToken(
  request: RefreshTokenRequest,
): Promise<AuthResponse> {
  return client.post<AuthResponse>(`${AUTH}/refresh`, request, { skipAuth: true });
}

export async function logout(accessToken: string): Promise<void> {
  await client.post(`${AUTH}/logout`, {}, {
    skipAuth: true,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/** Saves the signed-in person's language on their account; resolves with the language sessions will now report. */
export async function saveLanguage(language: string): Promise<string> {
  const result = await client.put<{ language: string }>("/identity/account/language", { language });
  return result.language;
}

export interface NotificationAlerts {
  popups: boolean;
  sound: boolean;
}

/** Saves the signed-in person's pop-up and chime choices on their account; resolves with both as saved. */
export async function saveNotificationAlerts(change: Partial<NotificationAlerts>): Promise<NotificationAlerts> {
  return client.put<NotificationAlerts>("/identity/account/alerts", change);
}

// ── Token storage (localStorage + cookie) ────────────────────────────

const STORAGE_KEY = "ey_hr_auth";

export function persistAuth(auth: StoredAuth): void {
  clearSessionExpired();
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(auth));
    document.cookie = `ey_hr_authenticated=true; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`;
    persistLanguageCookie(auth.user.language);
    window.dispatchEvent(new CustomEvent(AUTH_STORAGE_EVENT));
  }
}

export function loadAuth(): StoredAuth | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredAuth;
  } catch {
    return null;
  }
}

export function clearAuth(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
    document.cookie = "ey_hr_authenticated=; path=/; max-age=0; SameSite=Lax";
    window.dispatchEvent(new CustomEvent(AUTH_STORAGE_EVENT));
  }
}
