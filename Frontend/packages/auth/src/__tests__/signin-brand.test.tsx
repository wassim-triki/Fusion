import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { LAST_COMPANY_KEY } from "@repo/api";
import { SignInPage } from "../components/signin-page";
import { AuthProvider } from "../auth-context";

const mockSearchParamGet = vi.fn<(key: string) => string | null>();
vi.mock("next/navigation", () => ({ useSearchParams: () => ({ get: mockSearchParamGet }) }));
vi.mock("../organization-ready-landing", () => ({
  fetchOrganizationReadySignal: vi.fn().mockResolvedValue(false),
  useOrganizationReadyLanding: () => ({ pending: false, organizationReady: undefined }),
}));

const fetchMock = vi.fn();

function brandResponse(color: string | null) {
  return new Response(
    JSON.stringify({
      data: { name: "Carthage Digital Group", slug: "carthage", color, logoUrl: null, language: "en" },
      isSuccess: true,
      errors: [],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  mockSearchParamGet.mockReturnValue(null);
  window.localStorage.clear();
  document.cookie = "NEXT_LOCALE=en; path=/";
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.getElementById("fusion-brand")?.remove();
});

function renderPage() {
  return render(
    <AuthProvider>
      <SignInPage />
    </AuthProvider>,
  );
}

describe("sign-in in the company's brand (B-176)", () => {
  it("wears the company the link names: its name, its colour on the page", async () => {
    mockSearchParamGet.mockImplementation((key) => (key === "company" ? "carthage" : null));
    fetchMock.mockResolvedValue(brandResponse("#2f5fd0"));

    renderPage();

    expect(await screen.findByRole("heading", { level: 2, name: "Carthage Digital Group" })).toBeInTheDocument();
    expect(screen.getByText("to Carthage Digital Group")).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/identity/brand/companies/carthage");
    expect(document.getElementById("fusion-brand")?.textContent).toContain("--primary:#2f5fd0");
  });

  it("falls back to the company this browser last used", async () => {
    window.localStorage.setItem(LAST_COMPANY_KEY, "carthage");
    fetchMock.mockResolvedValue(brandResponse(null));

    renderPage();

    expect(await screen.findByRole("heading", { level: 2, name: "Carthage Digital Group" })).toBeInTheDocument();
  });

  it("shows Fusion's own side when no company is named, without asking the server", async () => {
    renderPage();

    expect(screen.getByRole("heading", { level: 2, name: "Fusion" })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });

  it("forgets a remembered company that no longer signs in", async () => {
    window.localStorage.setItem(LAST_COMPANY_KEY, "gone");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ errors: ["Company not found."] }), { status: 404 }));

    renderPage();

    await waitFor(() => expect(window.localStorage.getItem(LAST_COMPANY_KEY)).toBeNull());
    expect(screen.getByRole("heading", { level: 2, name: "Fusion" })).toBeInTheDocument();
  });
});
