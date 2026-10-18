import { describe, expect, it } from "vitest";
import robots from "./robots";

describe("robots", () => {
  it("allows the site, hides account pages in every language and links the sitemap", () => {
    const r = robots();
    const rule = (r.rules as { userAgent: string; allow: string; disallow: string[] }[])[0];
    expect(rule.allow).toBe("/");
    for (const p of ["/api/", "/wallet", "/*/wallet", "/profile", "/*/profile", "/my-list", "/*/my-list", "/rewards", "/*/rewards", "/search", "/*/search"]) {
      expect(rule.disallow).toContain(p);
    }
    expect(r.sitemap).toBe("http://localhost:3000/sitemap.xml");
    expect(r.host).toBe("http://localhost:3000");
  });
});
