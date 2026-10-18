import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";

vi.mock("next/navigation", () => import("@/test-utils/next-navigation"));
const track = vi.fn();
vi.mock("@/lib/analytics", () => ({ track: (...a: unknown[]) => track(...a) }));

import ErrorPage from "./error";

afterEach(() => vi.restoreAllMocks());

describe("route error boundary", () => {
  it("reports the error, offers retry/home/contact and shows the digest as a caption", async () => {
    const reset = vi.fn();
    const err = Object.assign(new Error("x".repeat(300)), { digest: "7f3a1c" });
    render(<ErrorPage error={err} reset={reset} />, { wrapper: appWrapper({ lang: "hi" }) });
    expect(track).toHaveBeenCalledWith("client_error", { digest: "7f3a1c", message: "x".repeat(200), path: "/" });
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Please try again in a moment.")).toBeInTheDocument();
    expect(screen.getByText("Reference 7f3a1c")).toBeInTheDocument();
    expect(screen.getByText("Go to home").getAttribute("href")).toBe("/hi");
    expect(screen.getByText("Contact support").getAttribute("href")).toBe("/hi/contact");
    await act(async () => void fireEvent.click(screen.getByText("Try again")));
    expect(reset).toHaveBeenCalled();
  });

  it("says so when the viewer is offline and omits the digest when absent", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<ErrorPage error={new Error("net")} reset={() => {}} />, { wrapper: appWrapper() });
    expect(screen.getByText("You are offline")).toBeInTheDocument();
    expect(screen.getByText("Check your connection and try again.")).toBeInTheDocument();
    expect(screen.queryByText(/Reference/)).toBeNull();
    expect(track).toHaveBeenCalledWith("client_error", expect.objectContaining({ digest: null }));
  });
});
