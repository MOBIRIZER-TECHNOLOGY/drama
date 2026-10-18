import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fail, mockApi } from "@/test/api";
import ForgotPage from "./page";
import { ForgotForm } from "./forgot-form";

describe("ForgotForm", () => {
  it("page links back to sign in", () => {
    render(<ForgotPage />);
    expect(screen.getByRole("link", { name: "Back to sign in" }).getAttribute("href")).toBe("/login");
  });

  it("sends the trimmed email, confirms vaguely, and can start over", async () => {
    const user = userEvent.setup();
    mockApi.post("/v1/admin/auth/forgot", { ok: true });
    render(<ForgotForm />);
    const send = screen.getByRole("button", { name: "Send reset link" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await user.type(screen.getByLabelText(/Email/), "  me@x.co ");
    await user.click(send);
    expect(await screen.findByRole("heading", { name: "Check your inbox" })).toBeTruthy();
    expect(mockApi.calls[0].body).toEqual({ email: "me@x.co" });
    expect(screen.getByRole("status").textContent).toContain("me@x.co");
    await user.click(screen.getByRole("button", { name: "Use a different address" }));
    expect(screen.getByRole("heading", { name: "Reset your password" })).toBeTruthy();
  });

  it("shows an error and clears it when the address changes", async () => {
    const user = userEvent.setup();
    mockApi.post("/v1/admin/auth/forgot", fail(500, "mail down"));
    render(<ForgotForm />);
    await user.type(screen.getByLabelText(/Email/), "a@b.co");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect((await screen.findByRole("alert")).textContent).toBe("mail down");
    await user.type(screen.getByLabelText(/Email/), "x");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
