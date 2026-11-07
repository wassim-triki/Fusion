import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { ForgotPasswordPage, ResetPasswordPage } from "../components/password-reset-page";

const params = new Map<string, string>();
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (key: string) => params.get(key) ?? null }),
}));

const REQUIREMENTS = {
  minimumLength: 10,
  maximumLength: 128,
  requiresLetter: true,
  requiresDigit: true,
  requiresLowercase: false,
  requiresUppercase: false,
  requiresSymbol: false,
};

const fetchMock = vi.fn();

/** Identity's answers by path: status and data (or details for a failure). */
function answer(routes: Record<string, { status: number; body: unknown }>) {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    const path = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((key) => url.includes(key));
    const { status, body } = path ? routes[path]! : { status: 404, body: null };
    const envelope =
      status < 300
        ? { isSuccess: true, data: body, errors: [] }
        : { isSuccess: false, data: null, errors: ["No"], details: body };
    return new Response(JSON.stringify(envelope), { status, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
}

function sentBody(path: string): unknown {
  const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith(path));
  return call ? JSON.parse(String((call[1] as RequestInit).body)) : undefined;
}

beforeEach(() => {
  fetchMock.mockReset();
  params.clear();
});

describe("ForgotPasswordPage", () => {
  it("sends the typed address and answers the same way whoever it belongs to", async () => {
    params.set("email", "rim@carthage.example");
    answer({ "/identity/auth/password-reset": { status: 202, body: null } });
    render(<ForgotPasswordPage />);

    expect(screen.getByLabelText("Email")).toHaveValue("rim@carthage.example");
    await userEvent.click(screen.getByRole("button", { name: "Send link" }));

    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
    expect(screen.getByText("rim@carthage.example")).toBeInTheDocument();
    expect(sentBody("/identity/auth/password-reset")).toEqual({ email: "rim@carthage.example" });
  });
});

describe("ResetPasswordPage", () => {
  it("takes the token out of the address and saves a password once it meets the rules", async () => {
    params.set("token", "one-time-token");
    params.set("company", "carthage");
    const replaceState = vi.spyOn(window.history, "replaceState");
    answer({
      "/password-reset/inspect": { status: 200, body: { state: "ready", email: "rim@carthage.example", passwordRequirements: REQUIREMENTS } },
      "/password-reset/complete": { status: 200, body: { state: "done", email: "rim@carthage.example", passwordRequirements: REQUIREMENTS } },
    });
    render(<ResetPasswordPage />);

    expect(await screen.findByText("rim@carthage.example")).toBeInTheDocument();
    expect(replaceState).toHaveBeenCalledWith(null, "", "/auth/reset-password?company=carthage");
    expect(sentBody("/password-reset/inspect")).toEqual({ token: "one-time-token" });

    const save = screen.getByRole("button", { name: "Save password" });
    await userEvent.type(screen.getByLabelText("New password"), "short");
    expect(save).toBeDisabled();
    await userEvent.clear(screen.getByLabelText("New password"));
    await userEvent.type(screen.getByLabelText("New password"), "Brand-new-42");
    await userEvent.type(screen.getByLabelText("Confirm password"), "Brand-new-42");
    expect(save).toBeEnabled();
    await userEvent.click(save);

    expect(await screen.findByRole("heading", { name: "Password changed" })).toBeInTheDocument();
    expect(sentBody("/password-reset/complete")).toEqual({ token: "one-time-token", newPassword: "Brand-new-42" });
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/auth/signin?company=carthage");
  });

  it("offers a new link when the link has expired", async () => {
    params.set("token", "old-token");
    answer({ "/password-reset/inspect": { status: 200, body: { state: "expired", email: null, passwordRequirements: REQUIREMENTS } } });
    render(<ResetPasswordPage />);

    expect(await screen.findByRole("heading", { name: "This link has expired" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /send a new link/i })).toHaveAttribute("href", "/auth/forgot-password");
    expect(screen.queryByLabelText("New password")).toBeNull();
  });

  it("ends on the reason when the link stops working while the form is open", async () => {
    params.set("token", "raced-token");
    answer({
      "/password-reset/inspect": { status: 200, body: { state: "ready", email: "rim@carthage.example", passwordRequirements: REQUIREMENTS } },
      "/password-reset/complete": { status: 409, body: { code: "used" } },
    });
    render(<ResetPasswordPage />);

    await userEvent.type(await screen.findByLabelText("New password"), "Brand-new-42");
    await userEvent.type(screen.getByLabelText("Confirm password"), "Brand-new-42");
    await userEvent.click(screen.getByRole("button", { name: "Save password" }));

    expect(await screen.findByRole("heading", { name: "This link was already used" })).toBeInTheDocument();
  });
});
