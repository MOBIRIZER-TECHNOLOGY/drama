import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const hdrs = vi.hoisted(() => ({ nonce: null as string | null }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(hdrs.nonce ? { "x-nonce": hdrs.nonce } : {}) }));
vi.mock("./globals.css", () => ({}));

import RootLayout, { metadata } from "./layout";

async function render(nonce: string | null) {
  hdrs.nonce = nonce;
  const el = await RootLayout({ children: <p>page body</p> } as Parameters<typeof RootLayout>[0]);
  return renderToStaticMarkup(el);
}

describe("RootLayout", () => {
  it("renders children inside the toast provider with token variables on <html>", async () => {
    const html = await render(null);
    expect(html).toContain('<html lang="en" class="h-full"');
    expect(html).toMatch(/--success:#2f9c66/);
    expect(html).toMatch(/--danger:#d9425c/);
    expect(html).toMatch(/--accent:/);
    expect(html).toContain("<p>page body</p>");
    expect(html).toContain('aria-live="polite"'); // ToastProvider's region
    expect(html).toContain("fonts.googleapis.com/css2");
  });
  it("emits the CSP nonce meta only when the proxy supplied one", async () => {
    expect(await render(null)).not.toContain("csp-nonce");
    const html = await render("abc123");
    expect(html).toContain('property="csp-nonce"');
    expect(html).toContain("abc123");
  });
  it("sets titles", () => {
    expect(metadata.title).toEqual({ default: "Katha Admin", template: "%s · Katha Admin" });
  });
});
