import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => import("@/test-utils/next-navigation"));

import Page from "./page";

const go = (lang: string, slug: string, sp: Record<string, string | string[] | undefined>) =>
  Page({ params: Promise.resolve({ lang, slug }), searchParams: Promise.resolve(sp) } as never);

describe("short link", () => {
  it("redirects to the series, keeping the language", async () => {
    await expect(go("hi", "my-show", {})).rejects.toThrow("NEXT_REDIRECT:/hi/series/my-show");
    await expect(go("en", "my-show", {})).rejects.toThrow("NEXT_REDIRECT:/series/my-show");
  });
  it("preserves repeated and single query params, skipping undefined", async () => {
    await expect(go("en", "x", { ep: "3", utm: ["a", "b"], skip: undefined })).rejects.toThrow("NEXT_REDIRECT:/series/x?ep=3&utm=a&utm=b");
  });
  it("encodes the slug", async () => {
    await expect(go("en", "a b/c", {})).rejects.toThrow("NEXT_REDIRECT:/series/a%20b%2Fc");
  });
});
