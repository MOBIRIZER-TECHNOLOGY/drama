import { expect } from "vitest";

/** Minimal jest-dom-style matchers (jest-dom is not a dependency). Import for side effects. */
type El = Element | null;
const norm = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim();

expect.extend({
  toBeInTheDocument(received: El) {
    const pass = !!received && received.ownerDocument.contains(received);
    return { pass, message: () => `expected element ${pass ? "not " : ""}to be in the document` };
  },
  toHaveTextContent(received: El, expected: string | RegExp) {
    const text = norm(received?.textContent ?? null);
    const pass = expected instanceof RegExp ? expected.test(text) : text.includes(expected);
    return { pass, message: () => `expected text ${JSON.stringify(text)} ${pass ? "not " : ""}to match ${String(expected)}` };
  },
  toHaveValue(received: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, expected: unknown) {
    const t = (received as HTMLInputElement).type;
    const actual = t === "number" ? (received.value === "" ? null : Number(received.value)) : received.value;
    const pass = this.equals(actual, expected);
    return { pass, message: () => `expected value ${JSON.stringify(actual)} ${pass ? "not " : ""}to equal ${JSON.stringify(expected)}` };
  },
  toHaveAttribute(received: Element, name: string, expected?: string) {
    const has = received.hasAttribute(name);
    const pass = expected === undefined ? has : has && received.getAttribute(name) === expected;
    return { pass, message: () => `expected ${name}=${received.getAttribute(name)} ${pass ? "not " : ""}to match ${expected}` };
  },
  toBeChecked(received: HTMLInputElement) {
    return { pass: received.checked, message: () => `expected checkbox ${received.checked ? "not " : ""}to be checked` };
  },
  toBeDisabled(received: HTMLElement) {
    const pass = (received as HTMLButtonElement).disabled === true;
    return { pass, message: () => `expected element ${pass ? "not " : ""}to be disabled` };
  },
});

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  interface Assertion<T = any> {
    toBeInTheDocument(): void;
    toHaveTextContent(expected: string | RegExp): void;
    toHaveValue(expected: unknown): void;
    toHaveAttribute(name: string, expected?: string): void;
    toBeChecked(): void;
    toBeDisabled(): void;
  }
}
