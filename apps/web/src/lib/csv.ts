"use client";

/**
 * Download rows as CSV.
 *
 * A viewer disputing their coin balance is asked to describe it, which nobody can do from a scrolling list.
 * This is the same escaping the admin console uses (RFC 4180, plus a guard against a leading `=`, `+`, `-` or
 * `@` so a spreadsheet does not execute a cell as a formula) and the same UTF-8 BOM, which is what makes Excel
 * read a Devanagari series title correctly instead of as mojibake.
 */
export function downloadCsv(
  filename: string,
  columns: { key: string; label: string }[],
  rows: Record<string, unknown>[],
): void {
  const cell = (value: unknown): string => {
    if (value == null) return "";
    const text = String(value);
    const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
  };

  const csv = [
    columns.map((c) => cell(c.label)).join(","),
    ...rows.map((row) => columns.map((c) => cell(row[c.key])).join(",")),
  ].join("\r\n");

  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
