import type { TenantOverviewRow } from "../api";
import { moduleLabel, tenantWords, type TenantWords } from "../language";

/**
 * The tenant directory as a file.
 *
 * It carries the same facts the list shows and nothing more: no credential
 * material, no invitation identifiers, no internal failure codes. An export
 * leaves the product, so it says only what a Platform Administrator already
 * reads on screen, in the language they read it in.
 */

const COLUMNS = [
  "tenant",
  "status",
  "administrator",
  "invitation",
  "delivery",
  "modules",
  "created",
] as const;

/**
 * A leading =, +, - or @ makes a spreadsheet treat the value as a formula. A
 * tenant is named by a customer, so the cell is neutralised rather than trusted.
 */
function escapeCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function toCsv(
  rows: TenantOverviewRow[],
  words: TenantWords = tenantWords()
): string {
  const lines = [
    COLUMNS.map((column) => escapeCell(words.say(`export.${column}`))).join(","),
  ];

  for (const row of rows) {
    lines.push(
      [
        row.name,
        words.status(row.administratorActivationStatus),
        row.initialAdministratorEmail ?? "",
        row.invitationState ? words.invitation(row.invitationState) : "",
        row.lastDeliveryOutcome ? words.delivery(row.lastDeliveryOutcome) : "",
        row.modules.map(moduleLabel).join("; "),
        // ISO keeps the file sortable and unambiguous between locales, which a
        // rendered date would not be.
        row.createdAt.slice(0, 10),
      ]
        .map(escapeCell)
        .join(",")
    );
  }

  // A trailing newline, so appending or concatenating the file behaves.
  return `${lines.join("\r\n")}\r\n`;
}

export function exportFileName(now: Date = new Date()): string {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");

  return `fusion-tenants-${stamp}.csv`;
}

/** A BOM so Excel reads the file as UTF-8 rather than mangling accented names. */
export function csvFile(csv: string): Blob {
  return new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
}
