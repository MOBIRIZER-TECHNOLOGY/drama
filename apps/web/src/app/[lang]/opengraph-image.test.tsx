import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchTranslations = vi.fn();
vi.mock("@/lib/server-data", () => ({ fetchTranslations: (...a: unknown[]) => fetchTranslations(...a) }));
const ctor = vi.fn();
vi.mock("next/og", () => ({
  ImageResponse: class {
    constructor(...args: unknown[]) {
      ctor(...args);
    }
  },
}));

import Image, { alt, contentType, size } from "./opengraph-image";

const text = (node: unknown): string => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  return text((node as { props?: { children?: unknown } }).props?.children);
};

beforeEach(() => {
  ctor.mockReset();
  fetchTranslations.mockReset();
});

describe("default opengraph image", () => {
  it("exposes image metadata", () => {
    expect({ alt, size, contentType }).toEqual({ alt: "Katha — short dramas", size: { width: 1200, height: 630 }, contentType: "image/png" });
  });

  it("uses the translated description as the tagline", async () => {
    fetchTranslations.mockResolvedValue({ "meta.description": "नमस्ते" });
    await Image({ params: Promise.resolve({ lang: "hi" }) });
    expect(fetchTranslations).toHaveBeenCalledWith("hi");
    expect(text(ctor.mock.calls[0][0])).toContain("नमस्ते");
    expect(ctor.mock.calls[0][1]).toEqual(size);
  });

  it("falls back to the English tagline and lists languages", async () => {
    fetchTranslations.mockResolvedValue({});
    await Image({ params: Promise.resolve({ lang: "en" }) });
    const t = text(ctor.mock.calls[0][0]);
    expect(t).toContain("Binge bite-sized dramas in your language.");
    expect(t).toContain("Tamil");
  });
});
