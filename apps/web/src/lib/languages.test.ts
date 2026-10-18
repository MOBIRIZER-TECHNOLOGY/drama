import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("languages", () => {
  it("defaults to en,hi when NEXT_PUBLIC_LANGS is unset", async () => {
    delete process.env.NEXT_PUBLIC_LANGS;
    const m = await import("./languages");
    expect(m.SUPPORTED_LANGS).toEqual(["en", "hi"]);
    expect(m.isSupportedLang("hi")).toBe(true);
    expect(m.isSupportedLang("fr")).toBe(false);
  });

  it("parses a configured list, trimming and dropping blanks", async () => {
    vi.stubEnv("NEXT_PUBLIC_LANGS", " en, ta ,,te ");
    const m = await import("./languages");
    expect(m.SUPPORTED_LANGS).toEqual(["en", "ta", "te"]);
  });

  it("builds locale hrefs", async () => {
    const m = await import("./languages");
    expect(m.localeHref("en", "/wallet")).toBe("/wallet");
    expect(m.localeHref("en", "wallet")).toBe("/wallet");
    expect(m.localeHref("hi", "/wallet")).toBe("/hi/wallet");
    expect(m.localeHref("hi", "/")).toBe("/hi");
    expect(m.localeHref("hi", "x")).toBe("/hi/x");
  });

  it("strips a supported language prefix only", async () => {
    const m = await import("./languages");
    expect(m.stripLang("/hi/wallet")).toBe("/wallet");
    expect(m.stripLang("/hi")).toBe("/");
    expect(m.stripLang("/wallet")).toBe("/wallet");
    expect(m.stripLang("")).toBe("/");
    expect(m.stripLang("/")).toBe("/");
  });
});
