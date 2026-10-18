import { describe, expect, it } from "vitest";
import { NAV, ROLES, canAccess, isRole, navFor, navSectionsFor } from "./nav";

describe("nav", () => {
  it("owner sees everything, others only their sections", () => {
    expect(navFor("owner")).toHaveLength(NAV.length);
    expect(navFor("support").map((n) => n.href)).toEqual(["/dashboard", "/users", "/moderation", "/reports", "/inbox"]);
    expect(navFor("finance").map((n) => n.href)).not.toContain("/accounts");
  });
  it("omits hidden items from the sidebar but keeps them routable", () => {
    NAV.push({ href: "/secret", label: "S", icon: "x", roles: ["owner"], section: "System", hidden: true });
    try {
      expect(navFor("owner").map((n) => n.href)).not.toContain("/secret");
      expect(canAccess("owner", "/secret")).toBe(true);
    } finally {
      NAV.pop();
    }
  });
  it("groups consecutive items by section", () => {
    const sections = navSectionsFor("editor");
    expect(sections.map((s) => s.section)).toEqual(["Overview", "Content", "Support"]);
    expect(sections[1].items.map((i) => i.href)).toEqual(["/dramas", "/categories", "/languages", "/pages"]);
    expect(navSectionsFor("owner").map((s) => s.section)).toEqual(["Overview", "Content", "Audience", "Monetisation", "Growth", "Support", "System"]);
  });
  it("validates roles", () => {
    expect([...ROLES]).toEqual(["owner", "editor", "support", "finance"]);
    expect(isRole("owner")).toBe(true);
    expect(isRole("root")).toBe(false);
    expect(isRole(1)).toBe(false);
  });
  it("denies by default and matches nested paths on a segment boundary", () => {
    expect(canAccess("owner", "/dramas/123/edit")).toBe(true);
    expect(canAccess("support", "/dramas")).toBe(false);
    expect(canAccess("owner", "/dramasx")).toBe(false);
    expect(canAccess("owner", "/nowhere")).toBe(false);
  });
});
