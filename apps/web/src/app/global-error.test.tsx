import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GlobalError from "./global-error";

// <html> cannot be mounted inside a div, so render into the document element's parent-less container quietly.
function mount(reset = () => {}) {
  vi.spyOn(console, "error").mockImplementation(() => {});
  return render(<GlobalError error={new Error("x")} reset={reset} />, { container: document.documentElement });
}

afterEach(() => window.history.pushState({}, "", "/"));

describe("global error boundary", () => {
  it("defaults to English and calls reset", () => {
    const reset = vi.fn();
    mount(reset);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Try again"));
    expect(reset).toHaveBeenCalled();
  });

  it("uses the language from the URL when it has a built-in translation", () => {
    window.history.pushState({}, "", "/hi/wallet");
    mount();
    expect(screen.getByText("कुछ गड़बड़ हो गई")).toBeInTheDocument();
    expect(screen.getByText("फिर से कोशिश करें")).toBeInTheDocument();
  });

  it("falls back to English for an unknown language prefix", () => {
    window.history.pushState({}, "", "/fr/x");
    mount();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("falls back to English on the server (no window)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("window", undefined);
    try {
      const el = GlobalError({ error: new Error("x"), reset: () => {} }) as { props: { lang: string } };
      expect(el.props.lang).toBe("en");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
