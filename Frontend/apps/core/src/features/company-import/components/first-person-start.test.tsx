import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CheckDto, CompanyImportDto, CoreImportApi } from "@repo/api";
import en from "../../../../messages/en/companyImport.json";
import fr from "../../../../messages/fr/companyImport.json";
import ar from "../../../../messages/ar/companyImport.json";
import { CheckCard } from "./chart-step";

afterEach(cleanup);

const offer: CheckDto = {
  key: "firstStart|person", kind: "firstPersonStart", subject: "person", title: "Amira Khelifi", detail: null,
  options: [
    { key: "keep", label: "2026-11-03", from: "current", lean: true },
    { key: "file", label: "2020-01-02", from: "file", lean: false },
  ], answer: "keep", count: 1,
};
const data = { id: "session", chart: { people: [{ key: "person", name: "Amira Khelifi", from: "people.csv · 2" }] } } as CompanyImportDto;

describe("the first person's import start choice", () => {
  it.each([
    ["en", en, "Keep", "Use"], ["fr", fr, "Garder", "Utiliser"], ["ar", ar, "الإبقاء", "استخدام"],
  ] as const)("shows both dated choices and keeps the server's choice in %s", (locale, messages, keep, use) => {
    const answer = vi.fn().mockResolvedValue(data);
    const run = vi.fn(async (_label: string, apply: (api: CoreImportApi, version: number) => Promise<CompanyImportDto>) =>
      apply({ answer } as unknown as CoreImportApi, 17));
    const change = { pending: null, error: null, clearError: vi.fn(), run };
    const view = (check: CheckDto) => (
      <NextIntlClientProvider locale={locale} messages={{ companyImport: messages }} timeZone="UTC">
        <CheckCard check={check} data={data} change={change} onShow={() => undefined} />
      </NextIntlClientProvider>
    );
    const { rerender } = render(view(offer));
    expect(screen.getByRole("radio", { name: new RegExp(keep) })).toHaveAttribute("aria-checked", "true");
    const file = screen.getByRole("radio", { name: new RegExp(use) });
    expect(file).toHaveAttribute("aria-checked", "false");
    expect(answer).not.toHaveBeenCalled();
    fireEvent.click(file);
    expect(answer).toHaveBeenCalledWith("session", 17, offer.key, "file");
    rerender(view({ ...offer, answer: "file" }));
    expect(screen.getByRole("radio", { name: new RegExp(use) })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(keep) }));
    expect(answer).toHaveBeenLastCalledWith("session", 17, offer.key, "keep");
  });
});
