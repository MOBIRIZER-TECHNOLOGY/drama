"use client";

import { useState } from "react";
import { Button, Textarea } from "./ui";

export type JsonObject = Record<string, unknown>;

/** Result of parsing a JSON object; `ok` discriminates so callers narrow after an early return. */
export type JsonParseResult = { ok: true; value: JsonObject } | { ok: false; error: string };

/** Parse text as a JSON object (not array/scalar). Empty text is an empty object. */
export function parseJsonObject(text: string): JsonParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    return { ok: false, error: e instanceof SyntaxError ? `Invalid JSON: ${e.message.replace(/^JSON\.parse: /, "")}` : "Invalid JSON" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: 'Must be a JSON object, e.g. { "key": 1 }' };
  }
  return { ok: true, value: parsed as JsonObject };
}

export function formatJson(value: unknown): string {
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

/**
 * Monospace textarea for a JSON object with live parse feedback and a Format button.
 * The parent owns the text (so a draft survives a failed save) and decides when to parse.
 */
export function JsonEditor({
  value,
  onChange,
  placeholder = "{ }",
  rows = 6,
  disabled,
  error,
}: {
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  /** Error from the parent's validation; when absent, the live parse error is shown after blur. */
  error?: string;
}) {
  const [touched, setTouched] = useState(false);
  const live = parseJsonObject(value);
  const shown = error ?? (touched && !live.ok ? live.error : undefined);
  return (
    <div className="flex flex-col gap-1.5">
      <Textarea
        value={value}
        rows={rows}
        disabled={disabled}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setTouched(true)}
        aria-invalid={shown ? true : undefined}
        className="font-mono text-xs leading-relaxed"
        style={{ minHeight: `${rows * 1.5 + 1}rem` }}
      />
      <div className="flex items-center justify-between gap-2">
        {shown ? (
          <span role="alert" className="text-xs text-danger">
            {shown}
          </span>
        ) : (
          <span className="text-xs text-muted">{live.ok ? `${Object.keys(live.value).length} key(s)` : ""}</span>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled || !live.ok}
          onClick={() => {
            if (live.ok) onChange(formatJson(live.value));
          }}
        >
          Format
        </Button>
      </div>
    </div>
  );
}
