import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { AuthProvider, useAuth } from "../auth-context";
import * as authService from "../auth-service";
import { makeAuthResponse, makeApiError, makeStoredAuth } from "./helpers";

// ── Spy on auth-service ──────────────────────────────────────────────

vi.mock("../auth-service", async () => {
  const actual = await vi.importActual<typeof authService>("../auth-service");
  return {
    ...actual,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    refreshToken: vi.fn(),
    persistAuth: vi.fn(),
    loadAuth: vi.fn(),
    clearAuth: vi.fn(),
  };
});

const mockedService = vi.mocked(authService);

beforeEach(() => {
  vi.clearAllMocks();
  mockedService.loadAuth.mockReturnValue(null);
});

// ── Test consumer that exposes auth state ────────────────────────────

function AuthConsumer() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(auth.isLoading)}</span>
      <span data-testid="authenticated">{String(auth.isAuthenticated)}</span>
      <span data-testid="user">{auth.user?.fullName ?? "none"}</span>
      <span data-testid="token">{auth.accessToken ?? "none"}</span>
      <button
        data-testid="login-btn"
        onClick={async () => {
          const failure = await auth.login({
            email: "john@example.com",
            password: "P@ss1",
          });
          if (failure) {
            const el = document.getElementById("errors");
            if (el) el.textContent = failure.messages.join(",");
          }
        }}
      />
      <button
        data-testid="register-btn"
        onClick={async () => {
          const errors = await auth.register({
            email: "jane@example.com",
            password: "Str0ng!",
            firstName: "Jane",
            lastName: "Smith",
            hireDate: "2025-01-15",
          });
          if (errors) {
            const el = document.getElementById("errors");
            if (el) el.textContent = errors.join(",");
          }
        }}
      />
      <button data-testid="logout-btn" onClick={() => auth.logout()} />
      <span id="errors" data-testid="errors" />
    </div>
  );
}

function renderWithProvider() {
  return render(
    <AuthProvider>
      <AuthConsumer />
    </AuthProvider>
  );
}

// ═════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════

describe("AuthProvider – initial state", () => {
  it("starts unauthenticated when nothing stored", async () => {
    renderWithProvider();

    await waitFor(() =>
      expect(screen.getByTestId("loading").textContent).toBe("false")
    );
    expect(screen.getByTestId("authenticated").textContent).toBe("false");
    expect(screen.getByTestId("user").textContent).toBe("none");
    // A leftover sign-in hint is expired with the empty session.
    expect(mockedService.clearAuth).toHaveBeenCalled();
  });

  it("hydrates from localStorage when token is valid", async () => {
    const stored = makeStoredAuth();
    mockedService.loadAuth.mockReturnValue(stored);

    renderWithProvider();

    await waitFor(() =>
      expect(screen.getByTestId("loading").textContent).toBe("false")
    );
    expect(screen.getByTestId("authenticated").textContent).toBe("true");
    expect(screen.getByTestId("user").textContent).toBe("John Doe");
    expect(screen.getByTestId("token").textContent).toBe("access-token-123");
  });

  it("refreshes expired token on mount", async () => {
    const expired = makeStoredAuth({
      accessTokenExpiration: new Date(Date.now() - 1000).toISOString(),
    });
    mockedService.loadAuth.mockReturnValue(expired);

    const freshAuth = makeAuthResponse({
      accessToken: "fresh-access",
      refreshToken: "fresh-refresh",
    });
    mockedService.refreshToken.mockResolvedValue(freshAuth);

    renderWithProvider();

    await waitFor(() =>
      expect(screen.getByTestId("token").textContent).toBe("fresh-access")
    );
    expect(mockedService.refreshToken).toHaveBeenCalledWith({
      refreshToken: expired.refreshToken,
    });
    expect(mockedService.persistAuth).toHaveBeenCalled();
  });

  it("clears auth when refresh fails", async () => {
    const expired = makeStoredAuth({
      accessTokenExpiration: new Date(Date.now() - 1000).toISOString(),
    });
    mockedService.loadAuth.mockReturnValue(expired);
    mockedService.refreshToken.mockRejectedValue(
      makeApiError(["Token expired"], 401)
    );

    renderWithProvider();

    await waitFor(() =>
      expect(screen.getByTestId("loading").textContent).toBe("false")
    );
    expect(mockedService.clearAuth).toHaveBeenCalled();
  });

  it("syncs auth state when storage changes in the same tab", async () => {
    const stored = makeStoredAuth();
    mockedService.loadAuth.mockReturnValue(stored);

    renderWithProvider();

    await waitFor(() =>
      expect(screen.getByTestId("authenticated").textContent).toBe("true")
    );

    mockedService.loadAuth.mockReturnValue(null);
    window.dispatchEvent(new CustomEvent(authService.AUTH_STORAGE_EVENT));

    await waitFor(() =>
      expect(screen.getByTestId("authenticated").textContent).toBe("false")
    );
    expect(screen.getByTestId("user").textContent).toBe("none");
  });
});

describe("AuthProvider – login", () => {
  it("sets user on successful login", async () => {
    const user = userEvent.setup();
    const authRes = makeAuthResponse();
    mockedService.login.mockResolvedValue(authRes);

    renderWithProvider();
    await waitFor(() =>
      expect(screen.getByTestId("loading").textContent).toBe("false")
    );

    await user.click(screen.getByTestId("login-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("authenticated").textContent).toBe("true")
    );
    expect(screen.getByTestId("user").textContent).toBe("John Doe");
    expect(mockedService.persistAuth).toHaveBeenCalled();
  });

  it("returns errors on failed login", async () => {
    const user = userEvent.setup();
    mockedService.login.mockRejectedValue(
      makeApiError(["Invalid credentials"], 401)
    );

    renderWithProvider();
    await waitFor(() =>
      expect(screen.getByTestId("loading").textContent).toBe("false")
    );

    await user.click(screen.getByTestId("login-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("errors").textContent).toBe(
        "Invalid credentials"
      )
    );
    expect(screen.getByTestId("authenticated").textContent).toBe("false");
  });
});

describe("AuthProvider – register", () => {
  it("sets user on successful registration", async () => {
    const user = userEvent.setup();
    const authRes = makeAuthResponse({ fullName: "Jane Smith" });
    mockedService.register.mockResolvedValue(authRes);

    renderWithProvider();
    await waitFor(() =>
      expect(screen.getByTestId("loading").textContent).toBe("false")
    );

    await user.click(screen.getByTestId("register-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("user").textContent).toBe("Jane Smith")
    );
    expect(screen.getByTestId("authenticated").textContent).toBe("true");
  });

  it("returns errors on failed registration", async () => {
    const user = userEvent.setup();
    mockedService.register.mockRejectedValue(
      makeApiError(["Email already registered"])
    );

    renderWithProvider();
    await waitFor(() =>
      expect(screen.getByTestId("loading").textContent).toBe("false")
    );

    await user.click(screen.getByTestId("register-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("errors").textContent).toBe(
        "Email already registered"
      )
    );
  });
});

describe("AuthProvider – logout", () => {
  it("clears auth state and calls server logout", async () => {
    const user = userEvent.setup();
    const stored = makeStoredAuth();
    mockedService.loadAuth.mockReturnValue(stored);
    mockedService.logout.mockResolvedValue(undefined);

    renderWithProvider();
    await waitFor(() =>
      expect(screen.getByTestId("authenticated").textContent).toBe("true")
    );

    await user.click(screen.getByTestId("logout-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("authenticated").textContent).toBe("false")
    );
    expect(screen.getByTestId("user").textContent).toBe("none");
    expect(mockedService.logout).toHaveBeenCalledWith("access-token-123");
    expect(mockedService.clearAuth).toHaveBeenCalled();
  });

  it("still clears state when server logout fails", async () => {
    const user = userEvent.setup();
    const stored = makeStoredAuth();
    mockedService.loadAuth.mockReturnValue(stored);
    mockedService.logout.mockRejectedValue(new Error("Network error"));

    renderWithProvider();
    await waitFor(() =>
      expect(screen.getByTestId("authenticated").textContent).toBe("true")
    );

    await user.click(screen.getByTestId("logout-btn"));

    await waitFor(() =>
      expect(screen.getByTestId("authenticated").textContent).toBe("false")
    );
    expect(mockedService.clearAuth).toHaveBeenCalled();
  });
});

describe("useAuth – outside provider", () => {
  it("throws when used outside AuthProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<AuthConsumer />)).toThrow(
      "useAuth must be used within an AuthProvider"
    );

    spy.mockRestore();
  });
});
