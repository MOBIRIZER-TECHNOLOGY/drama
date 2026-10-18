import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";
import { nav, resetNav } from "@/test-utils/next-navigation";
import { EmptyState, ErrorState, Field, Skeleton, inputClass } from "./states";

vi.mock("next/navigation", () => import("@/test-utils/next-navigation"));
beforeEach(() => resetNav());

describe("Skeleton / inputClass", () => {
  it("is aria-hidden and takes a class", () => {
    const { container } = render(<Skeleton className="h-4" />);
    expect(container.firstElementChild!.getAttribute("aria-hidden")).toBe("true");
    expect(container.firstElementChild!.className).toContain("h-4");
    expect(inputClass).toContain("h-11");
  });
});

describe("EmptyState", () => {
  it("renders title only", () => {
    const { container } = render(<EmptyState title="Nothing" />);
    expect(screen.getByText("Nothing")).toBeTruthy();
    expect(container.querySelector("p")).toBeNull();
  });
  it("renders icon, message, action and class", () => {
    const { container } = render(<EmptyState title="T" message="M" icon={<i data-testid="ic" />} action={<button>Go</button>} className="extra" />);
    expect(screen.getByText("M")).toBeTruthy();
    expect(screen.getByTestId("ic")).toBeTruthy();
    expect(screen.getByText("Go")).toBeTruthy();
    expect(container.firstElementChild!.className).toContain("extra");
  });
});

describe("Field", () => {
  it("shows the error in preference to the hint", () => {
    render(<Field label="L" htmlFor="x" hint="H" error="E"><input id="x" /></Field>);
    expect(screen.getByText("E")).toBeTruthy();
    expect(screen.queryByText("H")).toBeNull();
    expect(screen.getByLabelText("L")).toBeTruthy();
  });
  it("shows the hint, or nothing", () => {
    const { rerender } = render(<Field label="L" hint="H"><input /></Field>);
    expect(screen.getByText("H")).toBeTruthy();
    rerender(<Field label="L"><input /></Field>);
    expect(screen.queryByText("H")).toBeNull();
  });
});

describe("ErrorState", () => {
  const w = { wrapper: appWrapper() };
  it("defaults to generic copy", () => {
    render(<ErrorState />, w);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    expect(screen.getByText("Please try again in a moment.")).toBeTruthy();
    expect(screen.getByText("Try again")).toBeTruthy();
  });
  it.each([
    ["network_error", /could not reach Katha/],
    ["unauthorized", /session has ended/],
    ["validation_error", /not accepted/],
  ])("translates %s", (code, re) => {
    render(<ErrorState error={{ status: 0, code, message: "raw api text" }} />, w);
    expect(screen.getByRole("alert").textContent).toMatch(re);
    expect(screen.getByRole("alert").textContent).not.toContain("raw api text");
  });
  it("uses an explicit message over the error's, else the error's message", () => {
    const { unmount } = render(<ErrorState message="mine" error={{ status: 500, code: "error", message: "api" }} />, w);
    expect(screen.getByText("mine")).toBeTruthy();
    unmount();
    render(<ErrorState error={{ status: 500, code: "error", message: "api" }} title="T" retryLabel="Again" />, w);
    expect(screen.getByText("api")).toBeTruthy();
    expect(screen.getByText("T")).toBeTruthy();
    expect(screen.getByText("Again")).toBeTruthy();
  });
  it("retries via onRetry and shows busy meanwhile", async () => {
    let release!: () => void;
    const onRetry = vi.fn(() => new Promise<void>((r) => (release = r)));
    render(<ErrorState onRetry={onRetry} />, w);
    const btn = screen.getByText("Try again").closest("button") as HTMLButtonElement;
    fireEvent.click(btn);
    await waitFor(() => expect(btn.disabled).toBe(true));
    release();
    await waitFor(() => expect(btn.disabled).toBe(false));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
  it("falls back to router.refresh without onRetry", async () => {
    render(<ErrorState />, w);
    fireEvent.click(screen.getByText("Try again"));
    await waitFor(() => expect(nav.router.refresh).toHaveBeenCalled());
  });
});
