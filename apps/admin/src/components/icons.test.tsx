import "@/test/components-dom-matchers";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NAV } from "@/lib/nav";
import { Icon } from "./icons";

const pathOf = (name: string) => render(<Icon name={name} />).container.querySelector("path")!.getAttribute("d");

describe("Icon", () => {
  it("renders a decorative svg with the given size and class", () => {
    const { container } = render(<Icon name="film" size={30} className="x" />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("width", "30");
    expect(svg).toHaveAttribute("height", "30");
    expect(svg).toHaveClass("x");
  });
  it("defaults to 18px", () => {
    expect(render(<Icon name="film" />).container.querySelector("svg")).toHaveAttribute("width", "18");
  });
  it("falls back to the doc glyph for unknown names", () => {
    expect(pathOf("nope")).toBe(pathOf("doc"));
    expect(pathOf("film")).not.toBe(pathOf("doc"));
  });
  it("has a real glyph for every nav icon", () => {
    for (const n of NAV) if (n.icon !== "doc") expect(pathOf(n.icon), n.icon).not.toBe(pathOf("doc"));
  });
});
