// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { SsoSettingsDto } from "@repo/api";
import { IntlTestProvider } from "@repo/ds/testing";
import dsEn from "@repo/ds/messages/en.json";
import authEn from "@repo/auth/messages/en.json";
import { englishMessages } from "@/i18n/messages";
import { SingleSignOnBlock } from "./single-sign-on";

let settings: SsoSettingsDto;
const commands = { setProviders: vi.fn(), setRequirement: vi.fn(), refresh: vi.fn() };
vi.mock("./use-sso", () => ({
  useSsoSettings: () => ({ data: settings, error: null, refetch: vi.fn() }),
  useSsoCommands: () => commands,
}));

function base(overrides: Partial<SsoSettingsDto> = {}): SsoSettingsDto {
  return {
    canManage: true,
    allowMicrosoft: true,
    allowGoogle: true,
    microsoftAvailable: true,
    googleAvailable: true,
    redirectUri: "http://localhost:3000/api/identity/sso/callback/c/7d2e",
    connection: {
      id: "c1",
      kind: "MicrosoftEntra",
      displayName: "Carthage Digital",
      issuer: "https://login.microsoftonline.com/4f1c/v2.0",
      entraTenantId: "4f1c7e0a-0000-0000-0000-0000000092ab",
      clientId: "b2d8",
      secretSetAt: "2026-11-05T10:00:00Z",
      status: "Tested",
      lastTestAt: "2026-11-05T14:02:00Z",
      lastTestOutcome: "succeeded",
      lastTestEmail: "amira.khelifi@carthagedigital.tn",
      lastTestMessage: null,
      requiredAt: null,
      requiredByName: null,
      requiredEndedSessions: null,
      lastSignInAt: null,
    },
    domains: [{ domain: "carthagedigital.tn", provedAt: "2026-11-05T14:02:00Z" }],
    administrators: [
      { userId: "a1", name: "Amira Khelifi", hasPassword: true },
      { userId: "a2", name: "Rim Gharbi", hasPassword: false },
    ],
    you: { hasPassword: true, isAdministrator: true, confirmWith: ["company"], connectionLinkUsedAt: null },
    checks: { tested: true, domainProved: true, freshOwnLink: false, administratorWithPassword: true },
    ...overrides,
  };
}

async function renderBlock() {
  return render(
    <IntlTestProvider locale="en" messages={{ ...dsEn, ...authEn, ...englishMessages }}>
      <SingleSignOnBlock />
    </IntlTestProvider>,
  );
}

afterEach(cleanup);

describe("Settings › Sign-in › Single sign-on", () => {
  it("says what requiring the provider needs, and holds the switch until it's all true", async () => {
    settings = base();
    await renderBlock();

    expect(screen.getByText(/^Tested .*: signed in amira.khelifi@carthagedigital.tn$/)).toBeInTheDocument();
    expect(screen.getByText("You signed in with it in the last 15 minutes")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Require Carthage Digital" })).toBeDisabled();
    expect(screen.getByText("No password: Rim Gharbi.")).toBeInTheDocument();
  });

  it("lets the requirement turn on once everything is in place", async () => {
    settings = base({ checks: { tested: true, domainProved: true, freshOwnLink: true, administratorWithPassword: true } });
    await renderBlock();

    expect(screen.getByRole("switch", { name: "Require Carthage Digital" })).toBeEnabled();
    expect(screen.getByText(/People at carthagedigital.tn sign in only with Carthage Digital/)).toBeInTheDocument();
  });

  it("shows who required it and how many password sessions ended", async () => {
    settings = base();
    settings.connection = { ...settings.connection!, requiredAt: "2026-11-05T14:05:00Z", requiredByName: "Amira Khelifi", requiredEndedSessions: 41 };
    await renderBlock();

    expect(screen.getByText(/On for carthagedigital.tn, by Amira Khelifi/)).toBeInTheDocument();
    expect(screen.getByText(/41 password sessions ended/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace secret" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("reads without controls for someone who can't change it", async () => {
    settings = base({ canManage: false });
    await renderBlock();

    expect(screen.getByRole("switch", { name: "Sign in with Microsoft" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });

  it("offers to connect when the company has no provider", async () => {
    settings = base({ connection: null, domains: [] });
    await renderBlock();

    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });
});
