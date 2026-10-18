import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Loading from "./loading";

describe("series loading", () => {
  it("renders four rail skeletons", () => {
    const { container } = render(<Loading />);
    expect(container.querySelectorAll(".mb-10").length).toBe(4);
  });
});
