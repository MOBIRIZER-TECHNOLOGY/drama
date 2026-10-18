import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Loading from "./loading";

describe("category loading", () => {
  it("renders a grid of twelve card skeletons", () => {
    const { container } = render(<Loading />);
    expect(container.querySelector(".grid")!.children.length).toBe(12);
  });
});
