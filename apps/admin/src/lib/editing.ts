"use client";

import { useCallback, useEffect } from "react";

/**
 * Guards against losing work.
 *
 * The console tracked `dirty` on its long forms and did nothing with it: closing the tab, following a sidebar
 * link, or letting the 8-hour token expire discarded everything silently. An editor who has spent ten minutes
 * on a series form should never lose it to a mis-click.
 *
 * `beforeunload` covers tab close and reload. In-app navigation is covered by intercepting clicks on anchors
 * during the capture phase, which works for Next's client router without reaching into its internals.
 */
export function useUnsavedChanges(dirty: boolean, message = "You have unsaved changes. Leave without saving?") {
  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Browsers ignore custom text now, but returnValue must be set for the prompt to appear at all.
      e.returnValue = "";
    };

    const onClick = (e: MouseEvent) => {
      // Let modified clicks (new tab/window) through: they do not destroy this page's state.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest?.("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || anchor.target === "_blank") return;
      // Same page: nothing is lost.
      if (href === window.location.pathname + window.location.search) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, message]);
}

/**
 * Ctrl/Cmd+S saves.
 *
 * An editor saves a series form dozens of times a day and the browser's own "save page" dialog is never what
 * they wanted. Bound to the document rather than a form so it works wherever focus happens to be.
 */
export function useSaveShortcut(onSave: () => void, enabled = true) {
  const handler = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;
      if (e.key.toLowerCase() !== "s" || !(e.metaKey || e.ctrlKey) || e.altKey) return;
      e.preventDefault();
      onSave();
    },
    [enabled, onSave],
  );

  useEffect(() => {
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [handler]);
}

/**
 * Download rows as CSV.
 *
 * Every table in the console was a dead end for finance and support: reconciliation and any marketing list
 * meant "ask an engineer to query the database". Values are escaped per RFC 4180, and a leading =, +, - or @ is
 * prefixed with a quote so a spreadsheet does not execute a cell as a formula.
 */
export function downloadCsv(filename: string, columns: { key: string; label: string }[], rows: Record<string, unknown>[]): void {
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

  // The BOM makes Excel read UTF-8 correctly, which matters as soon as a title is in Devanagari.
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

/**
 * Parse CSV into rows. Handles quoted fields, escaped quotes and embedded newlines per RFC 4180.
 *
 * A translation vendor returns the file we exported, and their tooling will have quoted anything containing a
 * comma — splitting on "," would silently shred exactly the long sentences most likely to contain one.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  // A leading BOM survives a round trip through Excel and would otherwise become part of the first header.
  const input = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      // Swallow the \n of a \r\n pair rather than emitting an empty row.
      if (c === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}
