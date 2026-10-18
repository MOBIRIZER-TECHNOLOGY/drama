import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const track = vi.fn();
const remember = vi.fn();
vi.mock("@/lib/analytics", () => ({ track: (...a: unknown[]) => track(...a) }));
vi.mock("./SearchSuggestions", () => ({ rememberSearch: (...a: unknown[]) => remember(...a) }));

import { Beacon } from "./Beacon";

describe("Beacon", () => {
  it("fires one event with its props and renders nothing", () => {
    const { container } = render(<Beacon name="view" props={{ id: "x", n: 1 }} />);
    expect(container.innerHTML).toBe("");
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("view", { id: "x", n: 1 });
    expect(remember).not.toHaveBeenCalled();
  });
  it("fires without props", () => {
    render(<Beacon name="plain" />);
    expect(track).toHaveBeenCalledWith("plain", undefined);
  });
  it("does not refire for an equal payload, but does for a changed one; remembers searches", () => {
    const { rerender } = render(<Beacon name="s" props={{ q: "a" }} remember="a" />);
    rerender(<Beacon name="s" props={{ q: "a" }} remember="a" />);
    expect(track).toHaveBeenCalledTimes(1);
    rerender(<Beacon name="s" props={{ q: "b" }} remember="b" />);
    expect(track).toHaveBeenCalledTimes(2);
    expect(remember).toHaveBeenNthCalledWith(1, "a");
    expect(remember).toHaveBeenNthCalledWith(2, "b");
  });
});
