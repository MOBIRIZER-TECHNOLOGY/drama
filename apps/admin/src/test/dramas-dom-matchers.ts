/**
 * Importing this file (side effect) gives the dramas/users tests a few jest-dom-style matchers (the project does
 * not ship @testing-library/jest-dom) and the HTMLDialogElement.showModal/close behaviour jsdom lacks.
 */
import { expect, vi } from "vitest";

type R = { pass: boolean; message: () => string };
const el = (v: unknown) => v as HTMLElement;
const ok = (pass: boolean, msg: string): R => ({ pass, message: () => msg });

expect.extend({
  toBeInTheDocument(received: unknown) {
    const pass = received != null && document.documentElement.contains(el(received));
    return ok(pass, `expected element ${pass ? "not " : ""}to be in the document`);
  },
  toHaveTextContent(received: unknown, expected: string | RegExp) {
    const text = (el(received).textContent ?? "").replace(/\s+/g, " ").trim();
    const pass = typeof expected === "string" ? text.includes(expected) : expected.test(text);
    return ok(pass, `expected text ${JSON.stringify(text)} ${pass ? "not " : ""}to match ${String(expected)}`);
  },
  toHaveAttribute(received: unknown, name: string, value?: string) {
    const a = el(received).getAttribute(name);
    const pass = value === undefined ? a !== null : a === value;
    return ok(pass, `expected attribute ${name}=${String(a)} ${pass ? "not " : ""}to equal ${String(value)}`);
  },
  toHaveValue(received: unknown, expected: unknown) {
    const v = (received as HTMLInputElement).value;
    const pass = v === String(expected);
    return ok(pass, `expected value ${JSON.stringify(v)} ${pass ? "not " : ""}to be ${JSON.stringify(expected)}`);
  },
  toBeDisabled(received: unknown) {
    const pass = Boolean((received as HTMLButtonElement).disabled);
    return ok(pass, `expected element ${pass ? "not " : ""}to be disabled`);
  },
  toHaveFocus(received: unknown) {
    const pass = document.activeElement === received;
    return ok(pass, `expected element ${pass ? "not " : ""}to have focus`);
  },
  toBeChecked(received: unknown) {
    const e = el(received);
    const pass = (e as HTMLInputElement).checked === true || e.getAttribute("aria-checked") === "true";
    return ok(pass, `expected element ${pass ? "not " : ""}to be checked`);
  },
});

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  interface Assertion<T = any> {
    toBeInTheDocument(): void;
    toHaveTextContent(expected: string | RegExp): void;
    toHaveAttribute(name: string, value?: string): void;
    toHaveValue(expected: unknown): void;
    toBeDisabled(): void;
    toHaveFocus(): void;
    toBeChecked(): void;
  }
}

if (typeof HTMLDialogElement !== "undefined" && typeof HTMLDialogElement.prototype.showModal !== "function") {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}
// Lets @testing-library detect vitest fake timers (it looks for a `jest` global) so findBy*/waitFor/userEvent
// keep working while `vi.useFakeTimers()` has replaced setTimeout.
(globalThis as unknown as { jest: unknown }).jest = { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) };
export {};
