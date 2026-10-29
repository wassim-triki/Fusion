// @vitest-environment happy-dom
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NotificationPreferences } from "@repo/api";
import { IntlTestProvider } from "@repo/ds/testing";
import { renderWithIntl as render, shellMessages } from "@/test/intl";
import { Notifications } from "./notifications";
import { Preferences } from "./preferences";

const mocks = vi.hoisted(() => ({
  theme: "light",
  setTheme: vi.fn(),
  language: "en" as "en" | "fr",
  setLanguage: vi.fn<(next: "en" | "fr") => Promise<void>>(),
  preferences: undefined as NotificationPreferences | undefined,
  corePreferences: undefined as NotificationPreferences | undefined,
  mutate: vi.fn(),
  invalidateQueries: vi.fn(),
  alerts: { popups: true, sound: true },
  saveAlerts: vi.fn<(change: { popups?: boolean; sound?: boolean }) => Promise<void>>(async () => {}),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock("@repo/ds/shell", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTheme: () => ({ theme: mocks.theme, setTheme: mocks.setTheme }),
}));

vi.mock("@repo/auth", () => ({
  useLanguage: () => [mocks.language, mocks.setLanguage, false],
  useNotificationAlerts: () => ({ alerts: mocks.alerts, save: mocks.saveAlerts, saving: false }),
}));

vi.mock("@repo/api/query", () => ({
  useNotificationPreferences: (module: "core" | "performance") =>
    module === "core"
      ? { data: mocks.corePreferences, isPending: false, isError: false, error: null, refetch: vi.fn() }
      : {
          data: mocks.preferences,
          isPending: !mocks.preferences,
          isError: false,
          error: null,
          refetch: vi.fn(),
        },
  useUpdateNotificationPreferences: () => ({
    mutate: mocks.mutate,
    isPending: false,
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.corePreferences = undefined;
});

/**
 * Preferences as the app runs it: a saved language becomes the account's, and the next render (router.refresh)
 * reads the new language's catalogue.
 */
function RefreshingApp() {
  const [locale, setLocale] = useState<"en" | "fr">("en");
  mocks.language = locale;
  mocks.setLanguage.mockImplementation(async (next) => setLocale(next));
  return (
    <IntlTestProvider locale={locale} messages={shellMessages[locale]}>
      <Preferences />
    </IntlTestProvider>
  );
}

describe("Preferences", () => {
  afterEach(() => {
    mocks.language = "en";
  });

  it("binds appearance to the device theme and confirms with Saved", () => {
    render(<Preferences />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Preferences" })
    ).toBeTruthy();
    expect(
      screen.getByRole("radio", { name: "Light" }).getAttribute("aria-checked")
    ).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(mocks.setTheme).toHaveBeenCalledWith("dark");
    expect(screen.getByRole("status").textContent).toContain("Saved");
  });

  it("offers Match this device, and the account's language between English and Français", () => {
    render(<Preferences />);
    fireEvent.click(screen.getByRole("radio", { name: "Match this device" }));
    expect(mocks.setTheme).toHaveBeenCalledWith("system");
    expect(screen.getByText("Your account")).toBeTruthy();
    expect(
      screen
        .getByRole("radio", { name: "English" })
        .getAttribute("aria-checked")
    ).toBe("true");
  });

  it("saves Français to the account and re-renders in French", async () => {
    // As the app does it: the hook resolves, then the next render reads the French catalogue.
    const { container } = render(<RefreshingApp />);

    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Français" }));
    });

    expect(mocks.setLanguage).toHaveBeenCalledWith("fr");
    // The bell's notifications are worded by the server, so they're fetched again in French.
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["fusion-attention"],
    });
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: "Préférences" })
      ).toBeTruthy()
    );
    expect(screen.getByRole("radio", { name: "Sombre" })).toBeTruthy();
    expect(
      screen
        .getByRole("radio", { name: "Français" })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("Enregistré");
    expect(container.querySelector("[lang='fr']")).toBeTruthy();
  });

  it("offers العربية and reads in Arabic", () => {
    render(<Preferences />, { locale: "ar" });
    expect(
      screen.getByRole("heading", { level: 1, name: "التفضيلات" })
    ).toBeTruthy();
    expect(screen.getByRole("radio", { name: "داكن" })).toBeTruthy();
    expect(
      screen.getByRole("radio", { name: "العربية" }).getAttribute("lang")
    ).toBe("ar");
  });

  it("keeps English selected and says so when the save fails", async () => {
    mocks.setLanguage.mockRejectedValueOnce(
      new Error("Identity is unavailable")
    );
    render(<Preferences />);

    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Français" }));
    });

    expect(screen.getByRole("alert").textContent).toBe(
      "Couldn't save your language. Try again."
    );
    expect(
      screen
        .getByRole("radio", { name: "English" })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(
      screen.getByRole("heading", { level: 1, name: "Preferences" })
    ).toBeTruthy();
    expect(screen.getByRole("status").textContent).not.toContain("Saved");
  });
});

describe("the catalogue check", () => {
  const script = path.resolve(__dirname, "../../../scripts/check-messages.cjs");

  function check(en: object, fr: object) {
    const dir = mkdtempSync(path.join(tmpdir(), "shell-messages-"));
    writeFileSync(path.join(dir, "en.json"), JSON.stringify(en));
    writeFileSync(path.join(dir, "fr.json"), JSON.stringify(fr));
    // Arabic complete, so only the French gap is reported.
    writeFileSync(path.join(dir, "ar.json"), JSON.stringify(en));
    return spawnSync(process.execPath, [script, dir], { encoding: "utf8" });
  }

  it("passes the shell's own catalogues", () => {
    expect(
      spawnSync(process.execPath, [script], { encoding: "utf8" }).status
    ).toBe(0);
  });

  it("fails and names a key missing in French", () => {
    const result = check(
      { settings: { title: "Settings", saved: "Saved" } },
      { settings: { title: "Paramètres" } }
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("missing in fr.json: settings.saved");
  });
});

const PREFERENCES: NotificationPreferences = {
  emailAddress: "aicha.bouazizi@example.test",
  version: 4,
  groups: [
    {
      key: "plans-and-goals",
      label: "Plans and goals",
      summary:
        "Your plan approved or returned, updates asked of you, development goals added",
      email: true,
      locked: false,
      count: 4,
      items: [
        {
          label: "Your plan approved or returned",
          team: false,
          always: false,
          count: 2,
        },
      ],
    },
    {
      key: "one-on-ones",
      label: "1:1s",
      summary: "A 1:1 started or moved, actions assigned to you",
      email: false,
      locked: false,
      count: 3,
      items: [
        {
          label: "A 1:1 started or moved",
          team: false,
          always: false,
          count: 2,
        },
      ],
    },
    {
      key: "reviews-and-calibration",
      label: "Reviews and calibration",
      summary: "Reviews to write, peers to approve, your own review",
      email: true,
      locked: false,
      count: 13,
      items: [
        {
          label: "A review to write opens",
          team: true,
          always: false,
          count: 1,
        },
        {
          label: "A review of yours is due tomorrow or late",
          team: false,
          always: true,
          count: 1,
        },
      ],
    },
    {
      key: "deadline-reminders",
      label: "Deadline reminders",
      summary: "Something of yours is due soon or late",
      email: true,
      locked: true,
      count: 1,
      items: [
        {
          label: "A review of yours is due tomorrow or late",
          team: false,
          always: true,
          count: 1,
        },
      ],
    },
  ],
};

describe("Notifications", () => {
  it("shows where email goes, a switch per group and what the company requires", () => {
    mocks.preferences = PREFERENCES;
    render(<Notifications />);
    expect(screen.getByText("aicha.bouazizi@example.test")).toBeTruthy();
    expect(
      screen
        .getByRole("switch", { name: "Email for Plans and goals" })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(
      screen
        .getByRole("switch", { name: "Email for 1:1s" })
        .getAttribute("aria-checked")
    ).toBe("false");
    expect(
      screen.queryByRole("switch", { name: "Email for Deadline reminders" })
    ).not.toBeTruthy();
    expect(screen.getAllByText("Required").length).toBeGreaterThan(0);
  });

  it("lists Core HR's team and job changes beside Performance, switchable by email", () => {
    mocks.preferences = PREFERENCES;
    mocks.corePreferences = {
      emailAddress: "aicha.bouazizi@example.test",
      version: 0,
      groups: [
        {
          key: "team-and-job-changes",
          label: "Team and job changes",
          summary: "Your manager, your job, your team",
          email: true,
          locked: false,
          count: 2,
          items: [{ label: "Your manager changes", team: false, always: false, count: 1 }],
        },
      ],
    };
    render(<Notifications />);
    expect(screen.getByText("Core HR")).toBeTruthy();
    expect(screen.getByText("Your manager, your job, your team")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Email for Team and job changes" }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      { expectedVersion: 0, emailOff: ["team-and-job-changes"] },
      expect.anything()
    );
  });

  it("turns pop-ups and their sound on and off on the account", () => {
    mocks.preferences = PREFERENCES;
    render(<Notifications />);
    expect(screen.getByRole("switch", { name: "Pop-ups" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("switch", { name: "Sound" }));
    expect(mocks.saveAlerts).toHaveBeenCalledWith({ sound: false });
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });

  it("saves the whole set of groups turned off when one switch changes", () => {
    mocks.preferences = PREFERENCES;
    render(<Notifications />);
    fireEvent.click(
      screen.getByRole("switch", { name: "Email for Plans and goals" })
    );
    expect(mocks.mutate).toHaveBeenCalledWith(
      { expectedVersion: 4, emailOff: ["plans-and-goals", "one-on-ones"] },
      expect.anything()
    );
  });

  it("opens a group to its notifications, marking the team's", () => {
    mocks.preferences = PREFERENCES;
    render(<Notifications />);
    fireEvent.click(
      screen.getByRole("button", { name: /Reviews and calibration/ })
    );
    expect(screen.getByText("13 notifications")).toBeTruthy();
    const row = screen.getByText("A review to write opens").closest("li")!;
    expect(within(row).getByText("Your team")).toBeTruthy();
  });

  it("names Performance's groups and lines in French, and an unknown line as the server sent it", () => {
    mocks.preferences = {
      ...PREFERENCES,
      groups: PREFERENCES.groups.map((group) =>
        group.key === "one-on-ones"
          ? {
              ...group,
              items: [
                ...group.items,
                {
                  label: "A brand-new line",
                  team: false,
                  always: false,
                  count: 1,
                },
              ],
            }
          : group
      ),
    };
    render(<Notifications />, { locale: "fr" });
    expect(
      screen.getByRole("heading", { level: 1, name: "Notifications" })
    ).toBeTruthy();
    expect(
      screen.getByText("Les e-mails sont envoyés à").textContent
    ).toContain("aicha.bouazizi@example.test");
    expect(
      screen.getByRole("switch", { name: "E-mail pour Plans et objectifs" })
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Un entretien commencé ou déplacé, les actions qui vous sont attribuées"
      )
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: /Entretiens individuels/ })
    );
    expect(screen.getByText("3 notifications")).toBeTruthy();
    expect(screen.getByText("Un entretien commencé ou déplacé")).toBeTruthy();
    expect(screen.getByText("A brand-new line")).toBeTruthy();
  });
});
