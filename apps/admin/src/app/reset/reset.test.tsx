import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fail, mockApi } from "@/test/api";
import { nav } from "@/test/navigation";
import ResetPage from "./page";
import { ResetForm } from "./reset-form";

afterEach(() => vi.useRealTimers());

describe("ResetForm", () => {
  it("page wraps the form with a way back", () => {
    nav.set({ search: "token=t" });
    render(<ResetPage />);
    expect(screen.getByRole("heading", { name: "Choose a new password" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toBeTruthy();
  });

  it("explains a missing token", () => {
    render(<ResetForm />);
    expect(screen.getByRole("alert").textContent).toMatch(/needs the reset token/);
    expect(screen.getByRole("link", { name: "Request a new link" }).getAttribute("href")).toBe("/forgot");
  });

  it("validates length and confirmation before calling the API", async () => {
    const user = userEvent.setup();
    nav.set({ search: "token=t" });
    render(<ResetForm />);
    await user.type(screen.getByLabelText(/New password/), "short");
    await user.type(screen.getByLabelText(/Confirm password/), "other");
    await user.click(screen.getByRole("button", { name: "Set new password" }));
    expect(screen.getByText("Use at least 10 characters.")).toBeTruthy();
    expect(screen.getByText("The two passwords do not match.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText(/New password/));
    expect(mockApi.calls).toHaveLength(0);
    await user.type(screen.getByLabelText(/New password/), "x");
    expect(screen.queryByText("Use at least 10 characters.")).toBeNull();
    await user.type(screen.getByLabelText(/Confirm password/), "y");
    expect(screen.queryByText("The two passwords do not match.")).toBeNull();
  });

  it("resets, shows success and redirects to login after a delay", async () => {
    nav.set({ search: "token=abc" });
    mockApi.post("/v1/admin/auth/reset", { ok: true });
    const user = userEvent.setup();
    render(<ResetForm />);
    await user.type(screen.getByLabelText(/New password/), "correct horse battery");
    await user.type(screen.getByLabelText(/Confirm password/), "correct horse battery");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await user.click(screen.getByRole("button", { name: "Set new password" }));
    expect(await screen.findByRole("heading", { name: "Password updated" })).toBeTruthy();
    expect(mockApi.calls[0].body).toEqual({ token: "abc", password: "correct horse battery" });
    expect(nav.router.replace).toEqual([]);
    await act(async () => void vi.advanceTimersByTime(2500));
    expect(nav.router.replace).toEqual(["/login"]);
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
  });

  it("offers a new link when the token is expired, but not for other errors", async () => {
    nav.set({ search: "token=abc" });
    const user = userEvent.setup();
    mockApi.post("/v1/admin/auth/reset", fail(400, "Reset link is invalid or expired"));
    render(<ResetForm />);
    await user.type(screen.getByLabelText(/New password/), "correct horse battery");
    await user.type(screen.getByLabelText(/Confirm password/), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Set new password" }));
    expect((await screen.findByRole("alert")).textContent).toContain("invalid or expired");
    expect(screen.getByRole("link", { name: "Request a new link" })).toBeTruthy();
    mockApi.post("/v1/admin/auth/reset", fail(500, "boom"));
    await user.click(screen.getByRole("button", { name: "Set new password" }));
    await screen.findByText("boom");
    expect(screen.queryByRole("link", { name: "Request a new link" })).toBeNull();
  });
});
