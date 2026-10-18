import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fail, mockApi } from "@/test/api";
import { nav } from "@/test/navigation";
import { TOKEN_KEY } from "@/lib/token";
import LoginPage from "./page";
import { LoginForm } from "./login-form";

async function fill(user: ReturnType<typeof userEvent.setup>, email = " a@b.co ", password = "pw") {
  await user.type(screen.getByLabelText(/Email/), email);
  await user.type(screen.getByLabelText(/Password/), password);
}

describe("LoginForm", () => {
  it("renders from the page wrapper", async () => {
    render(<LoginPage />);
    expect(await screen.findByRole("heading", { name: "Katha Admin" })).toBeTruthy();
  });

  it("disables submit until email and password are present", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    const btn = screen.getByRole("button", { name: /Sign in/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    await fill(user);
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("signs in, stores the token and goes to the dashboard", async () => {
    const user = userEvent.setup();
    mockApi.post("/v1/admin/auth/login", { access_token: "jwt", expires_in: 100 });
    render(<LoginForm />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: /Sign in/ }));
    await waitFor(() => expect(nav.router.replace).toEqual(["/dashboard"]));
    expect(mockApi.calls[0].body).toEqual({ email: "a@b.co", password: "pw" });
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe("jwt");
  });

  it.each([
    ["/users?q=1", "/users?q=1"],
    ["https://evil.example/x", "/dashboard"],
    ["//evil.example/x", "/dashboard"],
    ["/login", "/dashboard"],
    ["/login/sub", "/dashboard"],
    ["http://[bad", "/dashboard"],
  ])("honours next=%s only when safe", async (next, expected) => {
    const user = userEvent.setup();
    nav.set({ search: `next=${encodeURIComponent(next)}` });
    mockApi.post("/v1/admin/auth/login", { access_token: "jwt", expires_in: 100 });
    render(<LoginForm />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: /Sign in/ }));
    await waitFor(() => expect(nav.router.replace).toEqual([expected]));
  });

  it("shows the reason banner, hidden once an error appears", async () => {
    const user = userEvent.setup();
    nav.set({ search: "reason=revoked" });
    mockApi.post("/v1/admin/auth/login", fail(401, { code: "unauthorized", message: "Invalid credentials" }));
    const { unmount } = render(<LoginForm />);
    expect(screen.getByRole("status").textContent).toMatch(/sessions were signed out/);
    await fill(user);
    await user.click(screen.getByRole("button", { name: /Sign in/ }));
    expect((await screen.findByRole("alert")).textContent).toBe("Invalid credentials");
    expect(screen.queryByRole("status")).toBeNull();
    unmount();
    nav.set({ search: "reason=expired" });
    render(<LoginForm />);
    expect(screen.getByRole("status").textContent).toMatch(/session expired/);
  });

  it("asks for the second factor, then reports a wrong code", async () => {
    const user = userEvent.setup();
    mockApi.post("/v1/admin/auth/login", fail(401, { code: "totp_required", message: "need code" }));
    render(<LoginForm />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: /Sign in/ }));
    const otp = await screen.findByLabelText(/Authenticator code/);
    expect(screen.queryByRole("alert")).toBeNull();
    const btn = screen.getByRole("button", { name: /Sign in/ }) as HTMLButtonElement;
    await user.type(otp, "12345");
    expect(btn.disabled).toBe(true);
    mockApi.post("/v1/admin/auth/login", fail(401, { code: "totp_invalid", message: "Wrong code" }));
    await user.type(otp, "6");
    await user.click(btn);
    expect((await screen.findByRole("alert")).textContent).toBe("Wrong code");
    expect((screen.getByLabelText(/Authenticator code/) as HTMLInputElement).value).toBe("");
    expect(mockApi.calls[1].body).toMatchObject({ otp: "123456" });
  });

  it("shows other failures, including unreachable API", async () => {
    const user = userEvent.setup();
    mockApi.post("/v1/admin/auth/login", () => {
      throw new TypeError("Failed to fetch");
    });
    render(<LoginForm />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: /Sign in/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Cannot reach the API/);
    expect(nav.router.replace).toEqual([]);
  });
});
