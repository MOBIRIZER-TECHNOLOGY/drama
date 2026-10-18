import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import AdminError from "./error";
import AdminLoading from "./loading";
import AdminNotFound from "./not-found";

describe("AdminError", () => {
  it("shows the error message, the digest and retries via reset", async () => {
    const reset = vi.fn();
    const err = Object.assign(new Error("kaboom"), { digest: "abc123" });
    render(<AdminError error={err} reset={reset} />);
    expect(screen.getByRole("alert").textContent).toContain("kaboom");
    expect(screen.getByText("ref abc123")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("falls back to a generic message and omits the digest line", () => {
    render(<AdminError error={new Error("")} reset={() => {}} />);
    expect(screen.getByText("Something went wrong rendering this page.")).toBeTruthy();
    expect(screen.queryByText(/^ref /)).toBeNull();
  });
});

describe("AdminLoading", () => {
  it("renders the loading state", () => {
    render(<AdminLoading />);
    expect(screen.getByRole("progressbar", { name: "Loading" })).toBeTruthy();
    expect(screen.getByText(/Loading…/)).toBeTruthy();
  });
});

describe("AdminNotFound", () => {
  it("explains and links back to the dashboard", () => {
    render(<AdminNotFound />);
    expect(screen.getByText("Page not found")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to dashboard" }).getAttribute("href")).toBe("/dashboard");
  });
});
