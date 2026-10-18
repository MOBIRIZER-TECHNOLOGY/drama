import { cleanup } from "@testing-library/react";
import { afterEach, expect } from "vitest";

// Newer Node versions ship their own experimental `localStorage`/`sessionStorage` globals, which shadow jsdom's
// (and are unusable without --localstorage-file). Point the globals back at jsdom's real Storage objects so
// tests see the same browser behaviour on every Node version.
const jsdomWindow = (globalThis as { jsdom?: { window: Window } }).jsdom?.window;
if (jsdomWindow) {
  for (const name of ["localStorage", "sessionStorage"] as const) {
    Object.defineProperty(globalThis, name, { configurable: true, get: () => jsdomWindow[name] });
  }
}

// Browser APIs jsdom does not implement. Tests that care about their behaviour replace these per test.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = class {
    readonly root = null;
    readonly rootMargin = "";
    readonly thresholds = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}
if (typeof window.matchMedia === "undefined") {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
if (typeof HTMLDialogElement !== "undefined" && typeof HTMLDialogElement.prototype.showModal !== "function") {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
}
Element.prototype.scrollBy ??= function () {} as never;
Element.prototype.scrollTo ??= function () {} as never;
Element.prototype.scrollIntoView ??= function () {};

afterEach(() => {
  cleanup();
  globalThis.localStorage?.clear();
  globalThis.sessionStorage?.clear();
});

// Minimal DOM matchers (a stand-in for @testing-library/jest-dom, which this workspace does not install).
expect.extend({
  toBeInTheDocument(received: Element | null) {
    const pass = !!received && received.ownerDocument.contains(received);
    return { pass, message: () => `expected element ${pass ? "not " : ""}to be in the document` };
  },
  toHaveAttribute(received: Element, name: string, value?: string) {
    const has = received.hasAttribute(name);
    const actual = received.getAttribute(name);
    const pass = value === undefined ? has : has && actual === value;
    return { pass, message: () => `expected ${name}${value === undefined ? "" : `="${value}"`} ${pass ? "not " : ""}on element (got ${has ? `"${actual}"` : "none"})` };
  },
  toBeDisabled(received: HTMLElement) {
    const pass = (received as HTMLButtonElement).disabled === true || received.closest("fieldset[disabled]") !== null;
    return { pass, message: () => `expected element ${pass ? "not " : ""}to be disabled` };
  },
  toBeEnabled(received: HTMLElement) {
    const pass = (received as HTMLButtonElement).disabled !== true;
    return { pass, message: () => `expected element ${pass ? "not " : ""}to be enabled` };
  },
  toHaveTextContent(received: Element, expected: string | RegExp) {
    const text = (received.textContent ?? "").replace(/\s+/g, " ").trim();
    const pass = typeof expected === "string" ? text.includes(expected) : expected.test(text);
    return { pass, message: () => `expected text "${text}" ${pass ? "not " : ""}to match ${String(expected)}` };
  },
  toHaveClass(received: Element, ...classes: string[]) {
    const pass = classes.every((c) => received.classList.contains(c));
    return { pass, message: () => `expected class list "${received.className}" ${pass ? "not " : ""}to contain ${classes.join(" ")}` };
  },
  toBeChecked(received: HTMLInputElement) {
    const pass = received.checked === true || received.getAttribute("aria-checked") === "true";
    return { pass, message: () => `expected element ${pass ? "not " : ""}to be checked` };
  },
  toHaveValue(received: HTMLInputElement, expected: unknown) {
    const pass = Object.is(received.value, expected);
    return { pass, message: () => `expected value ${JSON.stringify(received.value)} ${pass ? "not " : ""}to be ${JSON.stringify(expected)}` };
  },
});
