import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";

vi.mock("next/navigation", () => import("@/test-utils/next-navigation"));
const fetchPage = vi.fn();
const fetchLanguages = vi.fn();
const fetchTranslations = vi.fn();
vi.mock("@/lib/server-data", () => ({
  fetchPage: (...a: unknown[]) => fetchPage(...a),
  fetchLanguages: () => fetchLanguages(),
  fetchTranslations: (...a: unknown[]) => fetchTranslations(...a),
}));

import CmsPage, { generateMetadata } from "./page";

const args = { params: Promise.resolve({ lang: "hi", slug: "terms" }) } as never;
const doc = (over = {}) => ({ ok: true, data: { title: "Terms", body_html: "<h2>One</h2><p>x</p>", updated_at: "2026-03-05T12:00:00Z", ...over } });

beforeEach(() => {
  fetchPage.mockReset();
  fetchLanguages.mockReset().mockResolvedValue([{ code: "en" }, { code: "hi" }]);
  fetchTranslations.mockReset().mockResolvedValue({});
});

describe("CMS page metadata", () => {
  it("builds canonical and language alternates", async () => {
    fetchPage.mockResolvedValue(doc());
    expect(await generateMetadata(args)).toEqual({
      title: "Terms",
      alternates: { canonical: "/hi/p/terms", languages: { en: "/p/terms", hi: "/hi/p/terms" } },
    });
  });
  it("404s for a missing page, falls back for other failures", async () => {
    fetchPage.mockResolvedValue({ ok: false, status: 404 });
    await expect(generateMetadata(args)).rejects.toThrow("NEXT_NOT_FOUND");
    fetchPage.mockResolvedValue({ ok: false, status: 500 });
    expect(await generateMetadata(args)).toEqual({ title: "Page" });
  });
});

describe("CMS page", () => {
  const view = async () => render(await CmsPage(args), { wrapper: appWrapper() });

  it("404s on a missing page and shows an error state on other failures", async () => {
    fetchPage.mockResolvedValue({ ok: false, status: 404 });
    await expect(CmsPage(args)).rejects.toThrow("NEXT_NOT_FOUND");
    fetchPage.mockResolvedValue({ ok: false, status: 503 });
    await view();
    expect(screen.getByRole("alert")).toHaveTextContent("This page could not be loaded right now.");
  });

  it("renders title, updated date and sanitised HTML with heading ids", async () => {
    fetchPage.mockResolvedValue(doc({ body_html: '<h2>Refunds</h2><p>ok</p><script>alert(1)</script><a href="javascript:alert(1)">bad</a><img src="//evil.com/x.png" onerror="x()">' }));
    const { container } = await view();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Terms");
    expect(container.querySelector("time")!.getAttribute("datetime")).toBe("2026-03-05T12:00:00Z");
    expect(screen.getByText("Last updated")).toBeInTheDocument();
    const body = container.querySelector(".prose-cms")!;
    expect(body.querySelector("script")).toBeNull();
    expect(body.querySelector("a")!.getAttribute("href")).toBeNull();
    expect(body.querySelector("img")?.getAttribute("onerror") ?? null).toBeNull();
    expect(body.querySelector("img")?.getAttribute("src") ?? null).toBeNull();
    expect(body.querySelector("h2")!.id).toBe("refunds");
    expect(container.querySelector("nav")).toBeNull();
  });

  it("shows a table of contents for long documents, indenting h3s", async () => {
    fetchPage.mockResolvedValue(doc({ body_html: "<h2>A</h2><h3>B</h3><h2>C</h2>" }));
    const { container } = await view();
    const links = [...container.querySelectorAll("nav a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toEqual([["A", "#a"], ["B", "#b"], ["C", "#c"]]);
    expect(container.querySelectorAll("nav li")[1].className).toBe("ps-4");
  });

  it("omits the date when there is none", async () => {
    fetchPage.mockResolvedValue(doc({ updated_at: null }));
    const { container } = await view();
    expect(container.querySelector("time")).toBeNull();
  });
});
