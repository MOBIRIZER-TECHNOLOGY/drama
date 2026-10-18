import "@/test/components-dom-matchers";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { formatJson, JsonEditor, parseJsonObject } from "./json-editor";

describe("parseJsonObject", () => {
  it("treats blank text as an empty object", () => {
    expect(parseJsonObject("  ")).toEqual({ ok: true, value: {} });
  });
  it("parses objects", () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });
  it("reports syntax errors", () => {
    const r = parseJsonObject("{oops");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/^Invalid JSON: /);
  });
  it("rejects non-objects", () => {
    for (const t of ["[1]", "3", "null", '"s"']) {
      const r = parseJsonObject(t);
      expect(r, t).toEqual({ ok: false, error: 'Must be a JSON object, e.g. { "key": 1 }' });
    }
  });
  it("falls back to a generic message for non-SyntaxError throws", () => {
    const orig = JSON.parse;
    JSON.parse = () => {
      throw new Error("weird");
    };
    try {
      expect(parseJsonObject("{}")).toEqual({ ok: false, error: "Invalid JSON" });
    } finally {
      JSON.parse = orig;
    }
  });
});

describe("formatJson", () => {
  it("pretty prints, blanks null/undefined, and survives unserialisable values", () => {
    expect(formatJson({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(formatJson(null)).toBe("");
    expect(formatJson(undefined)).toBe("");
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    expect(formatJson(cyc)).toBe("");
    expect(formatJson(BigInt("1"))).toBe("");
  });
});

function Host({ initial, error, disabled }: { initial: string; error?: string; disabled?: boolean }) {
  const [v, setV] = useState(initial);
  return <JsonEditor value={v} onChange={setV} error={error} disabled={disabled} />;
}

describe("JsonEditor", () => {
  it("shows key count, and formats on click", async () => {
    const user = userEvent.setup();
    render(<Host initial='{"a":1,"b":2}' />);
    expect(screen.getByText("2 key(s)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Format" }));
    expect(screen.getByRole("textbox")).toHaveValue('{\n  "a": 1,\n  "b": 2\n}');
  });
  it("only shows the live parse error after blur and disables Format while invalid", async () => {
    const user = userEvent.setup();
    render(<Host initial="" />);
    const box = screen.getByRole("textbox");
    await user.type(box, "{{");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Format" })).toBeDisabled();
    await user.tab();
    expect(screen.getByRole("alert")).toHaveTextContent(/Invalid JSON/);
    expect(box).toHaveAttribute("aria-invalid", "true");
  });
  it("prefers the parent's error and honours disabled", () => {
    render(<Host initial="{}" error="Required" disabled />);
    expect(screen.getByRole("alert")).toHaveTextContent("Required");
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Format" })).toBeDisabled();
  });
});
