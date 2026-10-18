import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Logo } from "./Logo";

describe("Logo", () => {
  it("is decorative by default", () => {
    const { container } = render(<Logo />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBeNull();
    expect(svg.getAttribute("width")).toBe("28");
  });
  it("is an img with a label when given one, and gradient ids are per size", () => {
    const { container } = render(
      <>
        <Logo size={40} label="Katha" className="x" />
        <Logo size={20} />
      </>,
    );
    const [a, b] = Array.from(container.querySelectorAll("svg"));
    expect(a.getAttribute("role")).toBe("img");
    expect(a.getAttribute("aria-label")).toBe("Katha");
    expect(a.getAttribute("aria-hidden")).toBeNull();
    expect(a.getAttribute("class")).toBe("x");
    expect(a.querySelector("linearGradient")!.id).toBe("katha-40-l");
    expect(b.querySelector("linearGradient")!.id).toBe("katha-20-l");
  });
});
