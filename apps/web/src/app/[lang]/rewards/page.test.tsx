import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/rewards/RewardsView", () => ({ RewardsView: () => <div>rewards-view</div> }));

import Page, { dynamic, metadata } from "./page";

describe("rewards page", () => {
  it("is dynamic, noindex and renders the view", () => {
    render(<Page />);
    expect(screen.getByText("rewards-view")).toBeInTheDocument();
    expect(dynamic).toBe("force-dynamic");
    expect(metadata.robots).toEqual({ index: false });
  });
});
