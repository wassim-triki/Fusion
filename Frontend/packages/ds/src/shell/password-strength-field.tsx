"use client";

import { useMemo, useState } from "react";
import { Check, Eye, EyeOff, Lock, X } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Field,
  FieldError,
  FieldLabel,
} from "../components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "../components/ui/input-group";
import { cn } from "../lib/utils";

/** One required rule, as checkable state the recipient can see while typing. */
export interface PasswordCheck {
  label: string;
  satisfied: boolean;
}

/** The password rules the service says it enforces (Identity's `AccountPasswordPolicy.Describe`). */
export interface PasswordRequirements {
  minimumLength: number;
  /** Upper bound; advisory on the client, enforced by the service. */
  maximumLength?: number;
  /** At least one letter of either case. */
  requiresLetter?: boolean;
  requiresDigit: boolean;
  requiresLowercase: boolean;
  requiresUppercase: boolean;
  requiresSymbol: boolean;
}

/** A rule the checklist can show; each caller names it in its own words. */
export type PasswordRule = "length" | "letter" | "uppercase" | "lowercase" | "number" | "symbol";

/**
 * The client's one copy of the rule tests, mirroring the service's validators so the outstanding rule is visible
 * before submitting: a letter is any Unicode letter (`char.IsLetter`); upper, lower and digit are ASCII, as in Identity.
 */
export function passwordRuleChecks(
  password: string,
  requirements: PasswordRequirements | null | undefined,
  label: (rule: PasswordRule, minimumLength: number) => string,
): PasswordCheck[] {
  if (!requirements) return [];
  const row = (rule: PasswordRule, satisfied: boolean) => ({ label: label(rule, requirements.minimumLength), satisfied });
  return [
    row("length", password.length >= requirements.minimumLength),
    ...(requirements.requiresLetter ? [row("letter", /\p{L}/u.test(password))] : []),
    ...(requirements.requiresUppercase ? [row("uppercase", /[A-Z]/.test(password))] : []),
    ...(requirements.requiresLowercase ? [row("lowercase", /[a-z]/.test(password))] : []),
    ...(requirements.requiresDigit ? [row("number", /[0-9]/.test(password))] : []),
    ...(requirements.requiresSymbol ? [row("symbol", /[^\p{L}0-9]/u.test(password))] : []),
  ];
}

/**
 * Create-password field with live requirement feedback, after reui's c-input-23:
 * an advisory strength meter over the required requirement checklist.
 *
 * The distinction is deliberate. The checklist is the policy the service will
 * actually enforce — those rows gate the submit. The meter is advisory only: it
 * rewards optional strength (an uppercase letter, a symbol, extra length) so a
 * password can read "Medium" while already being valid. The meter never blocks.
 *
 * The field is data-agnostic: the caller computes `checks` from whichever
 * password-requirements shape its own API returns and passes them in, so this
 * component carries no product data types.
 */
export function PasswordStrengthField({
  id,
  label,
  value,
  onChange,
  checks,
  error,
  autoComplete = "new-password",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** The required rules, already evaluated against `value` by the caller. */
  checks: PasswordCheck[];
  error?: string;
  autoComplete?: string;
}) {
  const t = useTranslations("ds.password");
  const [reveal, setReveal] = useState(false);

  // Advisory strength, scored over required rules plus optional complexity.
  const score = useMemo(() => strengthScore(value, checks), [value, checks]);
  const meterColor = strengthColor(score, value.length > 0);

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>

      <InputGroup className="h-11">
        <InputGroupAddon>
          <Lock />
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          type={reveal ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          aria-describedby={`${id}-requirements`}
          onChange={(event) => onChange(event.target.value)}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-sm"
            onClick={() => setReveal((shown) => !shown)}
            aria-label={reveal ? t("hide") : t("show")}
          >
            {reveal ? <EyeOff /> : <Eye />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>

      {/* Segmented strength meter — advisory, five steps. */}
      <div
        className="mt-1 flex gap-1"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={5}
        aria-valuenow={score}
        aria-label={t("strength")}
      >
        {Array.from({ length: 5 }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-500",
              i < score ? meterColor : "bg-border"
            )}
          />
        ))}
      </div>

      {checks.length > 0 ? (
        <ul
          id={`${id}-requirements`}
          className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5"
        >
          {checks.map((check) => (
            <li key={check.label} className="flex items-center gap-1.5 text-xs">
              {check.satisfied ? (
                <Check aria-hidden="true" className="size-3.5 text-success" />
              ) : (
                <X
                  aria-hidden="true"
                  className="size-3.5 text-muted-foreground/60"
                />
              )}
              <span
                className={cn(
                  "transition-colors",
                  check.satisfied ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {check.label}
                <span className="sr-only">
                  {check.satisfied ? t("met") : t("notMet")}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

/** 0–5: the required checks met (up to 3, so the rule stays the caller's) plus optional complexity (upper, symbol). */
function strengthScore(password: string, checks: PasswordCheck[]): number {
  if (!password) return 0;
  const required = checks.length > 0 ? checks.filter((check) => check.satisfied).length / checks.length : 0;
  return Math.round(required * 3) + Number(/[A-Z]/.test(password)) + Number(/[^\p{L}0-9]/u.test(password));
}

/** Bar colour by score; the meter carries strength on its own, without a label. */
function strengthColor(score: number, hasInput: boolean): string {
  if (!hasInput) return "bg-border";
  if (score <= 2) return "bg-destructive";
  if (score <= 4) return "bg-primary";
  return "bg-success";
}
