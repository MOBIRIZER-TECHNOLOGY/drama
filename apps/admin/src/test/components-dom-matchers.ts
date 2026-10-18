/**
 * Minimal DOM matchers (jest-dom is not installed). Import for side effects:  `import "@/test/dom-matchers";`
 */
import { expect } from "vitest";

type R = { pass: boolean; message: () => string };
const el = (v: unknown) => v as HTMLElement;
const res = (pass: boolean, msg: string): R => ({ pass, message: () => msg });

expect.extend({
  toBeInTheDocument(received: unknown) {
    const e = received as Element | null;
    return res(!!e && e.ownerDocument.contains(e), "expected element to be in the document");
  },
  toHaveAttribute(received: unknown, name: string, value?: string) {
    const e = el(received);
    const has = e.hasAttribute(name);
    const pass = value === undefined ? has : has && e.getAttribute(name) === value;
    return res(pass, `expected attribute ${name}${value === undefined ? "" : `="${value}"`}, got ${e.getAttribute(name)}`);
  },
  toHaveTextContent(received: unknown, text: string | RegExp) {
    const t = (el(received).textContent ?? "").replace(/\s+/g, " ").trim();
    const pass = typeof text === "string" ? t.includes(text) : text.test(t);
    return res(pass, `expected text content "${t}" to match ${String(text)}`);
  },
  toHaveClass(received: unknown, ...names: string[]) {
    const e = el(received);
    return res(names.every((n) => e.classList.contains(n)), `expected classes ${names} on ${e.className}`);
  },
  toBeDisabled(received: unknown) {
    return res((el(received) as HTMLButtonElement).disabled === true, "expected element to be disabled");
  },
  toBeEnabled(received: unknown) {
    return res((el(received) as HTMLButtonElement).disabled === false, "expected element to be enabled");
  },
  toHaveValue(received: unknown, value: unknown) {
    const v = (el(received) as HTMLInputElement).value;
    return res(v === value, `expected value ${JSON.stringify(v)} to equal ${JSON.stringify(value)}`);
  },
  toBeChecked(received: unknown) {
    return res((el(received) as HTMLInputElement).checked === true, "expected element to be checked");
  },
});

declare module "vitest" {
  interface Assertion<T = any> { // eslint-disable-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
    toBeInTheDocument(): void;
    toHaveAttribute(name: string, value?: string): void;
    toHaveTextContent(text: string | RegExp): void;
    toHaveClass(...names: string[]): void;
    toBeDisabled(): void;
    toBeEnabled(): void;
    toHaveValue(value: unknown): void;
    toBeChecked(): void;
  }
}
