import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ProfileView", () => ({ ProfileView: () => <div>profile-view</div> }));

import Page, { dynamic, metadata } from "./page";

describe("profile page", () => {
  it("is dynamic, noindex and renders the view", () => {
    render(<Page />);
    expect(screen.getByText("profile-view")).toBeInTheDocument();
    expect(dynamic).toBe("force-dynamic");
    expect(metadata.robots).toEqual({ index: false });
  });
});
