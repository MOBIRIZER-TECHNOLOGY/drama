import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Loading from "./loading";

describe("home loading", () => {
  it("renders a hero skeleton and four rails of seven card skeletons", () => {
    const { container } = render(<Loading />);
    expect(container.querySelectorAll(".k-skeleton").length).toBeGreaterThanOrEqual(1 + 4 * (1 + 7));
  });
});
