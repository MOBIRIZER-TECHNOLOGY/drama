import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Breadcrumbs } from "./Breadcrumbs";

describe("Breadcrumbs", () => {
  it("renders nothing for fewer than two crumbs", () => {
    const { container } = render(<Breadcrumbs crumbs={[{ name: "Home", path: "/" }]} lang="en" label="Trail" />);
    expect(container.innerHTML).toBe("");
  });

  it("links earlier crumbs with locale hrefs and marks the last as the current page", () => {
    render(
      <Breadcrumbs
        lang="hi"
        label="Trail"
        crumbs={[{ name: "Home", path: "/" }, { name: "Browse", path: "/series" }, { name: "Show" }]}
      />,
    );
    expect(screen.getByRole("navigation", { name: "Trail" })).toBeTruthy();
    expect(screen.getByText("Home").closest("a")!.getAttribute("href")).toBe("/hi");
    expect(screen.getByText("Browse").closest("a")!.getAttribute("href")).toBe("/hi/series");
    const last = screen.getByText("Show");
    expect(last.closest("a")).toBeNull();
    expect(last.getAttribute("aria-current")).toBe("page");
  });

  it("renders a non-last crumb without a path as plain text", () => {
    render(<Breadcrumbs lang="en" label="T" crumbs={[{ name: "Plain" }, { name: "Last", path: "/x" }]} />);
    expect(screen.getByText("Plain").closest("a")).toBeNull();
    expect(screen.getByText("Last").closest("a")).toBeNull();
  });
});
