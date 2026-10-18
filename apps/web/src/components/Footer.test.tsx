import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeCategory } from "@/test-utils/fixtures";
import { Footer } from "./Footer";

const labels = { browse: "Browse", watch: "Watch", company: "Company", languages: "Languages", shorts: "Shorts", rewards: "Rewards" };
const langs = [
  { code: "en", name: "English", native_name: "English", rtl: false },
  { code: "hi", name: "Hindi", native_name: "", rtl: false },
];

describe("Footer", () => {
  it("renders genre, watch, company and language links with locale hrefs", () => {
    const cats = Array.from({ length: 10 }, (_, i) => makeCategory({ id: `c${i}`, slug: `g${i}`, name: `Genre ${i}` }));
    render(
      <Footer
        lang="hi"
        pages={[{ slug: "terms", title: "Terms" } as never]}
        categories={cats}
        languages={langs}
        contactLabel="Contact"
        tagline="Short dramas"
        labels={labels}
      />,
    );
    expect(screen.getByText("Short dramas")).toBeTruthy();
    expect(screen.getByText("Genre 0").getAttribute("href")).toBe("/hi/category/g0");
    expect(screen.queryByText("Genre 8")).toBeNull(); // capped at eight
    expect(screen.getByText("Terms").getAttribute("href")).toBe("/hi/p/terms");
    expect(screen.getByText("Contact").getAttribute("href")).toBe("/hi/contact");
    expect(screen.getByText("Shorts").getAttribute("href")).toBe("/hi/shorts");
    expect(screen.getByText("Rewards").getAttribute("href")).toBe("/hi/rewards");
    const en = screen.getByText("English");
    expect(en.getAttribute("href")).toBe("/");
    expect(en.className).not.toContain("font-medium");
    const hi = screen.getByText("Hindi"); // falls back to name
    expect(hi.getAttribute("href")).toBe("/hi");
    expect(hi.className).toContain("font-medium");
    expect(screen.getByText(`© ${new Date().getFullYear()} Katha`)).toBeTruthy();
  });

  it("omits the genre column and language strip when there is nothing to show", () => {
    render(
      <Footer lang="en" pages={[]} categories={[]} languages={[langs[0]]} contactLabel="Contact" tagline="t" labels={labels} />,
    );
    expect(screen.queryByRole("navigation", { name: "Languages" })).toBeNull();
    expect(screen.getAllByRole("navigation")).toHaveLength(2);
  });
});
