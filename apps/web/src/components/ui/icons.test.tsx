import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as icons from "./icons";

describe("icons", () => {
  const entries = Object.entries(icons) as [string, (p: Record<string, unknown>) => React.ReactElement][];

  it.each(entries)("%s renders an svg", (_name, Icon) => {
    const { container } = render(<Icon />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("sizes icons and hides them from assistive tech, and passes props through", () => {
    const { container } = render(<icons.IconPlay size={40} className="c" data-x="1" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("40");
    expect(svg.getAttribute("height")).toBe("40");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("class")).toBe("c");
    expect(svg.getAttribute("data-x")).toBe("1");
  });

  it("defaults to 20px", () => {
    const { container } = render(<icons.IconClose />);
    expect(container.querySelector("svg")!.getAttribute("width")).toBe("20");
  });

  it.each(["IconHeart", "IconStar", "IconGift", "IconHome", "IconShorts", "IconGrid"] as const)("%s has a filled variant", (name) => {
    const Icon = icons[name] as (p: { filled?: boolean }) => React.ReactElement;
    const plain = render(<Icon />).container.innerHTML;
    const filled = render(<Icon filled />).container.innerHTML;
    expect(filled).not.toBe(plain);
  });

  it("Spinner and Google icon take their own size props", () => {
    const s = render(<icons.Spinner size={30} className="spin" />).container.querySelector("svg")!;
    expect(s.getAttribute("width")).toBe("30");
    const g = render(<icons.IconGoogle size={33} />).container.querySelector("svg")!;
    expect(g.getAttribute("width")).toBe("33");
  });
});
