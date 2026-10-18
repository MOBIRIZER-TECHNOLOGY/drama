import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";
import { ToastProvider, useToast } from "./toast";

function Trigger({ tone }: { tone?: "info" | "success" | "error" | "gold" }) {
  const toast = useToast();
  return <button onClick={() => toast(`msg-${Math.random().toFixed(6)}`, tone)}>go</button>;
}

function setup(tone?: "info" | "success" | "error" | "gold") {
  render(
    <ToastProvider>
      <Trigger tone={tone} />
    </ToastProvider>,
    { wrapper: appWrapper() },
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Toast", () => {
  it("useToast outside a provider is a harmless no-op", () => {
      render(<Trigger />);
    fireEvent.click(screen.getByText("go"));
    expect(screen.queryByLabelText("Dismiss")).toBeNull();
  });

  it("shows a toast and auto-dismisses it after 3.5s", () => {
    setup();
    fireEvent.click(screen.getByText("go"));
    expect(screen.getAllByLabelText("Dismiss")).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(3499));
    expect(screen.getAllByLabelText("Dismiss")).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.queryByLabelText("Dismiss")).toBeNull();
  });

  it("keeps error toasts for 6s", () => {
    setup("error");
    fireEvent.click(screen.getByText("go"));
    act(() => void vi.advanceTimersByTime(5999));
    expect(screen.getAllByLabelText("Dismiss")).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.queryByLabelText("Dismiss")).toBeNull();
  });

  it("dismisses on click and cancels its timer", () => {
    setup("success");
    fireEvent.click(screen.getByText("go"));
    fireEvent.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByLabelText("Dismiss")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("caps the stack at four, evicting the oldest and its timer", () => {
    setup("gold");
    for (let i = 0; i < 6; i++) fireEvent.click(screen.getByText("go"));
    expect(screen.getAllByLabelText("Dismiss")).toHaveLength(4);
    expect(vi.getTimerCount()).toBe(4);
  });

  it("clears pending timers on unmount", () => {
      const { unmount } = render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
      { wrapper: appWrapper() },
    );
    fireEvent.click(screen.getByText("go"));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
