import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeCategory } from "@/test-utils/fixtures";
import { CategoryBar } from "./CategoryBar";

const cats = [makeCategory({ id: "1", slug: "romance", name: "Romance" }), makeCategory({ id: "2", slug: "thriller", name: "Thriller" })];

describe("CategoryBar", () => {
  it("renders nothing without categories", () => {
    const { container } = render(<CategoryBar categories={[]} lang="en" activeSlug={null} allLabel="All" label="Genres" />);
    expect(container.innerHTML).toBe("");
  });
  it("marks All current on the all page", () => {
    render(<CategoryBar categories={cats} lang="en" activeSlug={null} allLabel="All" label="Genres" />);
    expect(screen.getByText("All").getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("All").getAttribute("href")).toBe("/series");
    expect(screen.getByText("Romance").getAttribute("aria-current")).toBeNull();
  });
  it("marks the active category and uses locale hrefs", () => {
    render(<CategoryBar categories={cats} lang="hi" activeSlug="thriller" allLabel="All" label="Genres" />);
    expect(screen.getByText("All").getAttribute("aria-current")).toBeNull();
    expect(screen.getByText("Thriller").getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Thriller").getAttribute("href")).toBe("/hi/category/thriller");
  });
});
