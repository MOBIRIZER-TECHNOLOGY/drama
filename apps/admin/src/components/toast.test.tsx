import "@/test/components-dom-matchers";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "./toast";

function Harness({ onApi }: { onApi: (t: ReturnType<typeof useToast>) => void }) {
  onApi(useToast());
  return null;
}
function setup() {
  let api!: ReturnType<typeof useToast>;
  render(
    <ToastProvider>
      <Harness onApi={(t) => (api = t)} />
    </ToastProvider>,
  );
  return () => api;
}

afterEach(() => vi.useRealTimers());

describe("toast", () => {
  it("throws outside a provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Harness onApi={() => {}} />)).toThrow("useToast must be used inside ToastProvider");
  });

  it("renders each kind with the right role and expires after its ttl", () => {
    vi.useFakeTimers();
    const get = setup();
    act(() => {
      get().success("saved");
      get().info("fyi");
      get().error("broke");
    });
    expect(screen.getByRole("alert")).toHaveTextContent("broke");
    expect(screen.getAllByRole("status").map((e) => e.textContent)).toEqual(["saved×", "fyi×"]);
    act(() => void vi.advanceTimersByTime(4000));
    expect(screen.queryByText("saved")).toBeNull();
    expect(screen.queryByText("fyi")).toBeNull();
    expect(screen.getByText("broke")).toBeInTheDocument(); // errors linger 7s
    act(() => void vi.advanceTimersByTime(3000));
    expect(screen.queryByText("broke")).toBeNull();
  });

  it("keeps an action toast for 8s, honours durationMs, and runs the action then dismisses", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const get = setup();
    const undo = vi.fn();
    act(() => {
      get().info("deleted", { action: { label: "Undo", onClick: undo } });
      get().info("quick", { durationMs: 100 });
    });
    act(() => void vi.advanceTimersByTime(150));
    expect(screen.queryByText("quick")).toBeNull();
    act(() => void vi.advanceTimersByTime(5000));
    expect(screen.getByText("deleted")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledOnce();
    expect(screen.queryByText("deleted")).toBeNull();
  });

  it("dismisses with the x button and keeps only the five most recent", async () => {
    const user = userEvent.setup();
    const get = setup();
    act(() => {
      for (let i = 1; i <= 7; i++) get().info(`m${i}`);
    });
    expect(screen.queryByText("m1")).toBeNull();
    expect(screen.queryByText("m2")).toBeNull();
    expect(screen.getByText("m3")).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(5);
    await user.click(screen.getAllByRole("button", { name: "Dismiss" })[0]);
    expect(screen.queryByText("m3")).toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(4);
  });
});
