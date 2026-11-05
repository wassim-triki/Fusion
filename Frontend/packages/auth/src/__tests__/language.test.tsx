import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import type { ApiClient } from "@repo/api";
import { AuthProvider } from "../auth-context";
import { loadAuth, persistAuth } from "../auth-service";
import { useLanguage } from "../language";
import { makeApiError, makeAuthUser, makeStoredAuth } from "./helpers";

const { mockPut, mockRefresh } = vi.hoisted(() => ({ mockPut: vi.fn(), mockRefresh: vi.fn() }));

vi.mock("@repo/api", async () => {
  const actual = await vi.importActual<typeof import("@repo/api")>("@repo/api");
  return {
    ...actual,
    createPlatformApiClient: () => ({ put: mockPut }) as unknown as ApiClient,
  };
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

function localeCookie(): string | undefined {
  return document.cookie
    .split("; ")
    .find((part) => part.startsWith("NEXT_LOCALE="))
    ?.slice("NEXT_LOCALE=".length);
}

function clearLocaleCookie() {
  // happy-dom keeps an empty cookie for `max-age=0`; a past expiry removes it, as browsers do for both.
  document.cookie = "NEXT_LOCALE=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
}

beforeEach(() => {
  mockPut.mockReset();
  mockRefresh.mockReset();
  clearLocaleCookie();
});

describe("the language cookie", () => {
  it("is written from the session on sign-in and refresh", () => {
    persistAuth(makeStoredAuth({ user: makeAuthUser({ language: "fr" }) }));

    expect(localeCookie()).toBe("fr");
  });

  it("is left alone when the session carries no supported language", () => {
    persistAuth(makeStoredAuth({ user: makeAuthUser({ language: "xx" }) }));

    expect(localeCookie()).toBeUndefined();
  });
});

describe("useLanguage", () => {
  let setLanguage: (next: "en" | "fr") => Promise<void> = async () => {};

  function Probe() {
    const [language, set, saving] = useLanguage();
    setLanguage = set;
    return (
      <span data-testid="language" data-saving={String(saving)}>
        {language}
      </span>
    );
  }

  function renderSignedIn() {
    persistAuth(makeStoredAuth({ user: makeAuthUser({ language: "en" }) }));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
  }

  it("saves to the account, then updates the session and the cookie and re-renders", async () => {
    mockPut.mockResolvedValueOnce({ language: "fr" });
    renderSignedIn();
    await waitFor(() => expect(screen.getByTestId("language")).toHaveTextContent("en"));

    await act(() => setLanguage("fr"));

    expect(mockPut).toHaveBeenCalledWith("/identity/account/language", { language: "fr" });
    expect(loadAuth()?.user.language).toBe("fr");
    expect(localeCookie()).toBe("fr");
    expect(mockRefresh).toHaveBeenCalledOnce();
    expect(screen.getByTestId("language")).toHaveTextContent("fr");
  });

  it("changes nothing when the save fails", async () => {
    mockPut.mockRejectedValueOnce(makeApiError(["Identity is unavailable"], 500));
    renderSignedIn();
    await waitFor(() => expect(screen.getByTestId("language")).toHaveTextContent("en"));

    await act(async () => {
      await expect(setLanguage("fr")).rejects.toThrow();
    });

    expect(loadAuth()?.user.language).toBe("en");
    expect(localeCookie()).toBe("en");
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(screen.getByTestId("language")).toHaveTextContent("en");
    expect(screen.getByTestId("language")).toHaveAttribute("data-saving", "false");
  });

  it("reads an unknown stored value as English", async () => {
    persistAuth(makeStoredAuth({ user: makeAuthUser({ language: "xx" }) }));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("language")).toHaveTextContent("en"));
  });
});
