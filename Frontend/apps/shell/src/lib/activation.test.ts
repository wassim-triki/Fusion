import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import fr from "../../messages/fr.json";
import {
  type PasswordRequirements,
  ADMINISTRATOR_JOURNEY,
  BOOTSTRAP_JOURNEY,
  RECOVERY_JOURNEY,
  errorFor,
  formatExpiry,
  monogramFor,
  passwordChecks,
  scrubbedUrl,
  journeyTerminalState,
  terminalState,
  validateForm,
  type Say,
} from "./activation";

const french = createTranslator({ locale: "fr", messages: fr, namespace: "activation" });
const sayInFrench: Say = (key, values) => french(key as never, values as never);

const REQUIREMENTS: PasswordRequirements = {
  minimumLength: 8,
  requiresDigit: true,
  requiresLowercase: true,
  requiresUppercase: true,
  requiresSymbol: true,
};

describe("terminalState", () => {
  it("distinguishes every stopping point", () => {
    const titles = (
      [
        "invalid",
        "expired",
        "revoked",
        "superseded",
        "already_accepted",
        "existing_account",
        "session_unavailable",
      ] as const
    ).map((outcome) => terminalState(outcome).title);

    expect(new Set(titles).size).toBe(titles.length);
  });

  it("says an account was not created where none was", () => {
    for (const outcome of ["invalid", "expired", "revoked"] as const) {
      expect(terminalState(outcome).detail).toContain("No account was created");
    }
  });

  it("does not tell someone to repeat activation that already committed", () => {
    const state = terminalState("session_unavailable");

    // The account, membership and access exist. Anything else here would send
    // the recipient back to redo work that succeeded.
    expect(state.title).toContain("was created");
    expect(state.action).toEqual({ label: "Sign in", href: "/auth/signin" });
  });

  it("offers recovery only where recovery exists", () => {
    expect(terminalState("expired").action).toBeUndefined();
    expect(terminalState("existing_account").action).toBeUndefined();
    expect(terminalState("already_accepted").action?.href).toBe("/auth/signin");
  });

  it("never names a service, status or identifier", () => {
    const forbidden = [/http/i, /\b\d{3}\b/, /token/i, /invitation id/i, /tenant id/i, /error/i];

    for (const outcome of [
      "invalid",
      "expired",
      "revoked",
      "superseded",
      "already_accepted",
      "existing_account",
      "session_unavailable",
      "unavailable",
    ] as const) {
      const { title, detail } = terminalState(outcome);
      for (const pattern of forbidden) {
        expect(`${title} ${detail}`).not.toMatch(pattern);
      }
    }
  });

  it("falls back to the neutral refusal for anything unrecognised", () => {
    expect(terminalState("unavailable").title).toBe(terminalState("invalid").title);
  });
});

describe("passwordChecks", () => {
  it("reports each rule separately", () => {
    const checks = passwordChecks("abc", REQUIREMENTS);
    expect(checks).toHaveLength(5);
    expect(checks.filter((check) => check.satisfied).map((check) => check.label)).toEqual([
      "A lowercase letter",
    ]);
  });

  it("satisfies every rule for a compliant password", () => {
    expect(passwordChecks("Bootstrap@1", REQUIREMENTS).every((check) => check.satisfied)).toBe(
      true
    );
  });

  it("states only the rules the service actually enforces", () => {
    const relaxed = passwordChecks("abc", {
      ...REQUIREMENTS,
      requiresSymbol: false,
      requiresUppercase: false,
    });

    expect(relaxed.map((check) => check.label)).toEqual([
      "8 characters or more",
      "A lowercase letter",
      "A number",
    ]);
  });

  it("has nothing to say before the requirements are known", () => {
    expect(passwordChecks("anything", null)).toEqual([]);
  });
});

describe("validateForm", () => {
  const valid = {
    firstName: "Ada",
    lastName: "Admin",
    password: "Bootstrap@1",
    confirmPassword: "Bootstrap@1",
  };

  it("accepts a complete submission", () => {
    expect(validateForm(valid, REQUIREMENTS)).toEqual([]);
  });

  it("names each missing field", () => {
    const errors = validateForm(
      { firstName: "  ", lastName: "", password: "", confirmPassword: "" },
      REQUIREMENTS
    );

    expect(errors.map((error) => error.field)).toEqual(["firstName", "lastName", "password"]);
  });

  it("reports a mismatch against the confirmation, not the password", () => {
    const errors = validateForm({ ...valid, confirmPassword: "Bootstrap@2" }, REQUIREMENTS);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.field).toBe("confirmPassword");
  });

  it("does not report a mismatch when there is no password to match", () => {
    const errors = validateForm(
      { ...valid, password: "", confirmPassword: "" },
      REQUIREMENTS
    );
    expect(errors.map((error) => error.field)).toEqual(["password"]);
  });

  it("rejects a password that fails the stated requirements", () => {
    const errors = validateForm(
      { ...valid, password: "weakness", confirmPassword: "weakness" },
      REQUIREMENTS
    );
    expect(errors.map((error) => error.field)).toEqual(["password"]);
  });
});

describe("errorFor", () => {
  it("returns the message for the named field only", () => {
    const errors = [{ field: "password", message: "Too short." }];
    expect(errorFor(errors, "password")).toBe("Too short.");
    expect(errorFor(errors, "firstName")).toBeUndefined();
  });
});

describe("formatExpiry", () => {
  it("formats a real timestamp", () => {
    expect(formatExpiry("2026-08-14T09:30:00Z")).toContain("2026");
  });

  it("shows nothing rather than an invented value", () => {
    expect(formatExpiry(null)).toBeNull();
    expect(formatExpiry("not a date")).toBeNull();
  });
});

describe("scrubbedUrl", () => {
  it("removes the credential and keeps everything else", () => {
    expect(
      scrubbedUrl("http://localhost:3000/activate-invitation?credential=abc.def&ref=email")
    ).toBe("/activate-invitation?ref=email");
  });

  it("leaves a URL that never carried one alone", () => {
    expect(scrubbedUrl("http://localhost:3000/activate-invitation")).toBeNull();
  });
});

describe("terminalState for a late refusal", () => {
  it("treats not_activatable as a dead end, not something to retry", () => {
    // The service revalidates under a lock, so an invitation revoked, replaced
    // or expired while the recipient was typing refuses with this reason. It
    // used to fall through to the recoverable-failure branch, which kept the
    // form and told them to try again at a link that can never work.
    const state = terminalState("not_activatable");

    expect(state.title).toBe("This invitation link does not work");
    expect(state.detail).toContain("No account was created");
    expect(state.action).toBeUndefined();
  });
});

describe("in French", () => {
  it("says each stopping point and its recovery in French", () => {
    const state = terminalState("already_accepted", sayInFrench);
    expect(state.title).toBe("Cette invitation a déjà été utilisée");
    expect(state.action).toEqual({ label: "Se connecter", href: "/auth/signin" });
    expect(journeyTerminalState(RECOVERY_JOURNEY, "expired", sayInFrench).title).toBe(
      "Cette invitation de récupération a expiré"
    );
  });

  it("states the password rules and the form's errors in French", () => {
    expect(passwordChecks("", REQUIREMENTS, sayInFrench).map((check) => check.label)).toEqual([
      "8 caractères ou plus",
      "Une majuscule",
      "Une minuscule",
      "Un chiffre",
      "Un symbole",
    ]);
    const errors = validateForm({ firstName: "", lastName: "", password: "", confirmPassword: "" }, REQUIREMENTS, sayInFrench);
    expect(errorFor(errors, "firstName")).toBe("Saisissez votre prénom.");
  });
});

describe("monogramFor", () => {
  it("takes the first and last significant word", () => {
    expect(monogramFor("Northwind Tunisia")).toBe("NT");
    // The middle word is skipped, so the initials stay two letters however many
    // words the tenant name has.
    expect(monogramFor("Banque Internationale Arabe")).toBe("BA");
  });

  it("uses two letters of a single word", () => {
    expect(monogramFor("Halden")).toBe("HA");
  });

  it("splits on the separators tenant names actually use", () => {
    expect(monogramFor("Acme-Tunisie")).toBe("AT");
    expect(monogramFor("Groupe/Delta")).toBe("GD");
  });

  it("ignores punctuation rather than turning it into an initial", () => {
    expect(monogramFor("  &Vega   Holdings, Ltd. ")).toBe("VL");
  });

  it("keeps non-Latin names legible", () => {
    expect(monogramFor("شركة الأمل")).toBe("شا");
  });

  it("returns nothing when there is no name to abbreviate", () => {
    // The tile renders empty rather than showing a placeholder glyph; the tenant
    // name beside it is always the authoritative label.
    expect(monogramFor(null)).toBe("");
    expect(monogramFor("   ")).toBe("");
    expect(monogramFor("!!!")).toBe("");
  });
});

describe("bootstrap handoff", () => {
  it("hands the new administrator to canonical tenant-foundation orientation", () => {
    // Tenant foundation is a tenant-level destination, so the handoff carries no
    // module prefix — and points at the readiness-aware Getting Started route,
    // not the retired /setup or Core setup routes.
    expect(BOOTSTRAP_JOURNEY.destination).toBe("/getting-started");
  });

  it("uses the purpose-specific administrator and recovery destinations", () => {
    expect(ADMINISTRATOR_JOURNEY.destination).toBe("/core/settings/roles/administrators");
    expect(RECOVERY_JOURNEY.destination).toBe("/getting-started");
  });
});
