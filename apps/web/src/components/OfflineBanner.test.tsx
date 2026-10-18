import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";

const track = vi.fn();
vi.mock("@/lib/analytics", () => ({ track: (...a: unknown[]) => track(...a) }));

import { OfflineBanner } from "./OfflineBanner";

const setOnline = (v: boolean) => Object.defineProperty(navigator, "onLine", { value: v, configurable: true });
afterEach(() => setOnline(true));

describe("OfflineBanner", () => {
  it("shows nothing while online", () => {
    setOnline(true);
    const { container } = render(<OfflineBanner />, { wrapper: appWrapper() });
    expect(container.innerHTML).toBe("");
    expect(track).not.toHaveBeenCalled();
  });

  it("shows when offline and reports it once", () => {
    setOnline(false);
    render(<OfflineBanner />, { wrapper: appWrapper() });
    expect(screen.getByRole("status").textContent).toContain("You are offline");
    expect(track).toHaveBeenCalledWith("offline", { state: "offline" });
  });

  it("follows offline/online events", () => {
    setOnline(true);
    render(<OfflineBanner />, { wrapper: appWrapper() });
    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toBeTruthy();
    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByRole("status")).toBeNull();
  });
});
