import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeCategory } from "@/test-utils/fixtures";
import { SearchFacets } from "./SearchFacets";

const labels = { group: "Filters", genre: "Genre", status: "Status", length: "Length", any: "Any", completed: "Completed", ongoing: "Ongoing", short: "Short", medium: "Medium", long: "Long", clear: "Clear filters" };
const cats = [makeCategory({ id: "1", slug: "romance", name: "Romance" }), makeCategory({ id: "2", slug: "thriller", name: "Thriller" })];

const render_ = (active = {}, lang = "en") => render(<SearchFacets q="love & war" lang={lang} active={active} categories={cats} labels={labels} />);
const href = (text: string) => screen.getByText(text).getAttribute("href");

describe("SearchFacets", () => {
  it("builds hrefs that keep the other active facets and encode q", () => {
    render_({ status: "ongoing" });
    expect(href("Romance")).toBe("/search?q=love+%26+war&status=ongoing&category=romance");
    expect(href("Short")).toBe("/search?q=love+%26+war&status=ongoing&length=short");
  });

  it("selecting the active facet toggles it off", () => {
    render_({ category: "romance", status: "completed", length: "long" });
    expect(href("Romance")).toBe("/search?q=love+%26+war&status=completed&length=long");
    expect(href("Completed")).toBe("/search?q=love+%26+war&category=romance&length=long");
    expect(href("Long")).toBe("/search?q=love+%26+war&category=romance&status=completed");
    expect(href("Any")).toBe("/search?q=love+%26+war&status=completed&length=long");
    expect(screen.getByText("Romance").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Thriller").getAttribute("aria-pressed")).toBe("false");
  });

  it("shows a clear link only when something is active, with a locale-prefixed href", () => {
    const a = render_({}, "hi");
    expect(screen.queryByText("Clear filters")).toBeNull();
    expect(href("Ongoing")).toBe("/hi/search?q=love+%26+war&status=ongoing");
    a.unmount();
    render_({ length: "short" }, "hi");
    expect(href("Clear filters")).toBe("/hi/search?q=love%20%26%20war");
  });

  it("is a labelled group", () => {
    render_();
    expect(screen.getByRole("group", { name: "Filters" })).toBeTruthy();
  });
});
