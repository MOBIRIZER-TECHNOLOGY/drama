import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SORTS, SortBar, isSort } from "./SortBar";

describe("SortBar", () => {
  it("isSort accepts only known sorts", () => {
    for (const s of SORTS) expect(isSort(s)).toBe(true);
    expect(isSort("nope")).toBe(false);
    expect(isSort(undefined)).toBe(false);
    expect(isSort("")).toBe(false);
  });

  it("renders one link per ordering, marking the active one", () => {
    const labels = { featured: "Featured", popular: "Popular", newest: "Newest", updated: "Updated" };
    render(<SortBar active="popular" hrefFor={(s) => `/series?sort=${s}`} labels={labels} label="Sort" />);
    expect(screen.getByRole("navigation", { name: "Sort" })).toBeTruthy();
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Featured", "Popular", "Newest", "Updated"]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual(SORTS.map((s) => `/series?sort=${s}`));
    expect(links.map((l) => l.getAttribute("aria-current"))).toEqual([null, "true", null, null]);
  });
});
