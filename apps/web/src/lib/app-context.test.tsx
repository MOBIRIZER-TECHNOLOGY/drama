import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { appWrapper } from "@/test-utils/app";
import { useApp, useHref, useT } from "./app-context";

describe("app-context", () => {
  it("useApp throws outside the provider", () => {
    expect(() => renderHook(() => useApp())).toThrow("useApp must be used inside AppProvider");
  });

  it("useApp returns the provided value", () => {
    const { result } = renderHook(() => useApp(), { wrapper: appWrapper({ lang: "hi" }) });
    expect(result.current.lang).toBe("hi");
  });

  it("useT prefers the catalogue, falls back to inline text and interpolates", () => {
    const { result } = renderHook(() => useT(), {
      wrapper: appWrapper({ messages: { "a.b": "Namaste {name} x{n}", empty: "" } }),
    });
    const t = result.current;
    expect(t("a.b", "Hello", { name: "Ann", n: 2 })).toBe("Namaste Ann x2");
    expect(t("missing", "Hello {x} {x}", { x: "y" })).toBe("Hello y y");
    expect(t("empty", "Fallback")).toBe("Fallback");
    expect(t("missing", "Plain")).toBe("Plain");
  });

  it("useHref prefixes by language", () => {
    const en = renderHook(() => useHref(), { wrapper: appWrapper({ lang: "en" }) });
    expect(en.result.current("/x")).toBe("/x");
    const hi = renderHook(() => useHref(), { wrapper: appWrapper({ lang: "hi" }) });
    expect(hi.result.current("/x")).toBe("/hi/x");
  });
});
