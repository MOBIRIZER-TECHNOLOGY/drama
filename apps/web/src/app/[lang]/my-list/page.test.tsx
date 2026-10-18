import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/MyListView", () => ({ MyListView: () => <div>my-list-view</div> }));

import Page, { dynamic, metadata } from "./page";

describe("my-list page", () => {
  it("is dynamic, noindex and renders the view", () => {
    render(<Page />);
    expect(screen.getByText("my-list-view")).toBeInTheDocument();
    expect(dynamic).toBe("force-dynamic");
    expect(metadata.robots).toEqual({ index: false });
  });
});
