// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ActivateInvitation } from "./activate-invitation";

let search = "credential=test-credential";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  search = "credential=test-credential";
  document.getElementById("fusion-brand")?.remove();
});

const json = (data: unknown) =>
  new Response(JSON.stringify({ isSuccess: true, data, errors: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

it("wears the company the link names, and says what the invitation is for (B-205)", async () => {
  search = "credential=test-credential&company=carthage";
  const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
    String(input).includes("/identity/brand/companies/carthage")
      ? json({ name: "Carthage Digital Group", slug: "carthage", color: "#2f5fd0", logoUrl: null, language: "en" })
      : json({
          state: "account_creation",
          tenantName: "Carthage Digital Group",
          invitedEmail: "amira.khelifi@example.test",
          expiresAt: null,
          firstName: "Amira",
          lastName: "Khelifi",
          passwordRequirements: null,
        })
  );
  vi.stubGlobal("fetch", fetchMock);
  render(<ActivateInvitation />);

  expect(await screen.findByRole("heading", { level: 1, name: "Join Carthage Digital Group" })).toBeTruthy();
  expect(await screen.findByRole("heading", { level: 2, name: "Carthage Digital Group" })).toBeTruthy();
  expect(screen.getByText("Your role")).toBeTruthy();
  expect(screen.getByText("Administrator")).toBeTruthy();
  expect(screen.getByText("amira.khelifi@example.test")).toBeTruthy();
  expect(document.getElementById("fusion-brand")?.textContent).toContain("--primary:#2f5fd0");
});

it("keeps the first administrator's work choice and conditional job title connected", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      json: async () => ({
        data: {
          state: "account_creation",
          tenantName: "Test Company",
          invitedEmail: "admin@example.test",
          expiresAt: null,
          firstName: "Test",
          lastName: "Person",
          passwordRequirements: null,
        },
      }),
    })
  );
  render(<ActivateInvitation />);
  const yes = await screen.findByRole("radio", { name: "Yes, I work here" });
  const no = screen.getByRole("radio", {
    name: "No, I'm setting it up for them",
  });
  expect(yes.getAttribute("aria-checked")).toBe("true");
  expect(screen.getByLabelText("Your job title")).toBeTruthy();
  fireEvent.click(no);
  expect(no.getAttribute("aria-checked")).toBe("true");
  expect(screen.queryByLabelText("Your job title")).toBeNull();
  fireEvent.click(yes);
  expect(screen.getByLabelText("Your job title")).toBeTruthy();
});

it("offers the providers the invited address can accept with, above the password (B-191)", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    if (String(input).includes("/identity/sso/flows")) {
      return new Response(JSON.stringify({ isSuccess: true, data: { authorizeUrl: "https://login.example/authorize" }, errors: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return {
      json: async () => ({
        data: {
          state: "account_creation",
          tenantName: "Carthage Digital Group",
          invitedEmail: "youssef.haddad@carthagedigital.tn",
          expiresAt: null,
          firstName: "Youssef",
          lastName: "Haddad",
          passwordRequirements: null,
          waysIn: {
            password: true,
            passwordForAdministratorsOnly: false,
            providers: [
              { key: "company", label: "Carthage Digital" },
              { key: "microsoft", label: "Microsoft" },
            ],
          },
        },
      }),
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  const assign = vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
  render(<ActivateInvitation />);

  const company = await screen.findByRole("button", { name: /Continue with Carthage Digital/ });
  expect(screen.getByRole("button", { name: /Continue with Microsoft/ })).toBeTruthy();
  expect(screen.getByText("or create a password")).toBeTruthy();

  fireEvent.click(company);
  await vi.waitFor(() => expect(assign).toHaveBeenCalledWith("https://login.example/authorize"));
  const started = fetchMock.mock.calls.find(([url]) => String(url).includes("/identity/sso/flows"));
  expect(JSON.parse(String((started?.[1] as RequestInit).body))).toEqual({
    purpose: "invitation",
    provider: "company",
    invitation: { kind: "bootstrap", credential: "test-credential" },
  });
  expect(window.sessionStorage.getItem("fusion_sso_origin")).toContain("credential=test-credential");
});
