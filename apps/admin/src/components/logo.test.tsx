import "@/test/components-dom-matchers";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Logo } from "./logo";

describe("Logo", () => {
  it("is decorative by default", () => {
    const { container } = render(<Logo />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).not.toHaveAttribute("role");
    expect(svg).toHaveAttribute("width", "28");
  });
  it("exposes a label as an image", () => {
    render(<Logo label="Katha" size={40} className="c" />);
    const img = screen.getByRole("img", { name: "Katha" });
    expect(img).toHaveAttribute("height", "40");
    expect(img).not.toHaveAttribute("aria-hidden");
    expect(img).toHaveClass("c");
  });
  it("suffixes gradient ids by size so two sizes don't share fills", () => {
    const { container } = render(
      <>
        <Logo size={20} />
        <Logo size={30} />
      </>,
    );
    const ids = [...container.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("katha-20-l");
    expect(ids).toContain("katha-30-play");
  });
});
