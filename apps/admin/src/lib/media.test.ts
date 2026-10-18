import { afterEach, describe, expect, it, vi } from "vitest";

async function load(base: string | undefined) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_MEDIA_BASE", base as never);
  return (await import("./media")).mediaSrc;
}
afterEach(() => vi.unstubAllEnvs());

describe("mediaSrc", () => {
  it("returns null for empty values", async () => {
    const mediaSrc = await load("https://cdn.example.com/");
    expect(mediaSrc(null)).toBeNull();
    expect(mediaSrc(undefined)).toBeNull();
    expect(mediaSrc("")).toBeNull();
  });
  it("keeps absolute and data URLs", async () => {
    const mediaSrc = await load("https://cdn.example.com");
    expect(mediaSrc("https://x.test/a.jpg")).toBe("https://x.test/a.jpg");
    expect(mediaSrc("//x.test/a.jpg")).toBe("//x.test/a.jpg");
    expect(mediaSrc("data:image/png;base64,AA")).toBe("data:image/png;base64,AA");
  });
  it("resolves keys against the media base without doubling slashes", async () => {
    const mediaSrc = await load("https://cdn.example.com/");
    expect(mediaSrc("library/a/cover.jpg")).toBe("https://cdn.example.com/library/a/cover.jpg");
    expect(mediaSrc("/library/a/cover.jpg")).toBe("https://cdn.example.com/library/a/cover.jpg");
  });
  it("returns null for keys when no base is configured", async () => {
    const mediaSrc = await load(undefined);
    expect(mediaSrc("library/a.jpg")).toBeNull();
    expect(mediaSrc("https://x.test/a.jpg")).toBe("https://x.test/a.jpg");
  });
});
