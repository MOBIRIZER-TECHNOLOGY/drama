import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchSeries = vi.fn();
vi.mock("@/lib/server-data", () => ({ fetchSeries: (...a: unknown[]) => fetchSeries(...a) }));
const ctor = vi.fn();
vi.mock("next/og", () => ({ ImageResponse: class { constructor(...a: unknown[]) { ctor(...a); } } }));

import Image, { alt, contentType, size } from "./opengraph-image";

type Node = { type?: string; props?: { children?: unknown; src?: string; style?: { fontSize?: number } } } | string | null | false | undefined | Node[];
const walk = (n: Node, out: { text: string[]; imgs: string[]; fontSizes: number[] }) => {
  if (n == null || n === false) return out;
  if (typeof n === "string") return out.text.push(n), out;
  if (Array.isArray(n)) return n.forEach((c) => walk(c, out)), out;
  if (n.type === "img") out.imgs.push(n.props!.src!);
  if (n.props?.style?.fontSize) out.fontSizes.push(n.props.style.fontSize);
  walk(n.props?.children as Node, out);
  return out;
};
const render = async (data: unknown) => {
  fetchSeries.mockResolvedValue(data);
  ctor.mockReset();
  await Image({ params: Promise.resolve({ lang: "en", slug: "s" }) });
  return walk(ctor.mock.calls[0][0], { text: [], imgs: [], fontSizes: [] });
};

beforeEach(() => fetchSeries.mockReset());

describe("series opengraph image", () => {
  it("exports image metadata", () => {
    expect({ alt, size, contentType }).toEqual({ alt: "Katha", size: { width: 1200, height: 630 }, contentType: "image/png" });
  });

  it("composes title, counts and a decodable poster", async () => {
    const r = await render({ ok: true, data: { title: "Show", episode_count: 12, free_episodes: 3, cover_url: "https://cdn/x.JPG?v=1" } });
    expect(r.text).toEqual(expect.arrayContaining(["Show", "12 episodes", "First 3 free"]));
    expect(r.imgs).toEqual(["https://cdn/x.JPG?v=1"]);
    expect(r.fontSizes).toContain(78);
    expect(ctor.mock.calls[0][1]).toEqual(size);
  });

  it("drops covers the renderer cannot decode (webp, avif, none)", async () => {
    for (const cover of ["https://cdn/x.webp", "https://cdn/x.avif?w=1", null]) {
      expect((await render({ ok: true, data: { title: "S", episode_count: 1, free_episodes: 0, cover_url: cover } })).imgs).toEqual([]);
    }
    expect((await render({ ok: true, data: { title: "S", cover_url: "https://cdn/p.png#frag" } })).imgs).toEqual(["https://cdn/p.png#frag"]);
  });

  it("shrinks long titles and hides zero counts", async () => {
    const r = await render({ ok: true, data: { title: "x".repeat(41), episode_count: 0, free_episodes: 0 } });
    expect(r.fontSizes).toContain(62);
    expect(r.text.some((t) => t.includes("episodes") || t.includes("free"))).toBe(false);
  });

  it("falls back to a bare brand card when the series cannot be loaded", async () => {
    const r = await render({ ok: false, status: 404 });
    expect(r.text).toContain("Katha");
    expect(r.imgs).toEqual([]);
  });
});
