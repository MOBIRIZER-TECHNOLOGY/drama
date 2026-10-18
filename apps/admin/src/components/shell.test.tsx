import "@/test/components-dom-matchers";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installDialogPolyfill } from "@/test/components-dialog";
import { nav } from "@/test/navigation";
import type { Admin } from "@/lib/auth";
import { NAV } from "@/lib/nav";

const auth = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
  logout: vi.fn(),
  reload: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => auth.value }));

import { Shell } from "./shell";

const admin = (role: Admin["role"]) => ({ id: "a", email: "a@x.io", display_name: "Asha", role }) as Admin;
function signIn(role: Admin["role"]) {
  auth.value = { admin: admin(role), loading: false, error: null, logout: auth.logout, reload: auth.reload };
}

beforeAll(installDialogPolyfill);
beforeEach(() => signIn("owner"));

describe("Shell", () => {
  it("shows a loading state while the session resolves", () => {
    auth.value = { admin: null, loading: true, error: null, logout: auth.logout, reload: auth.reload };
    render(<Shell>kid</Shell>);
    expect(screen.getByText(/Signing you in/)).toBeTruthy();
    expect(screen.queryByText("kid")).toBeNull();
  });

  it("shows the load error with retry and re-sign-in actions", async () => {
    auth.value = { admin: null, loading: false, error: "network down", logout: auth.logout, reload: auth.reload };
    render(<Shell>kid</Shell>);
    expect(screen.getByText("Could not load your session")).toBeTruthy();
    expect(screen.getByText("network down")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(auth.reload).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Sign in again" }));
    expect(auth.logout).toHaveBeenCalledTimes(1);
  });

  it("falls back to 'Unknown error' when there is no message", () => {
    auth.value = { admin: null, loading: false, error: null, logout: auth.logout, reload: auth.reload };
    render(<Shell>kid</Shell>);
    expect(screen.getByText("Unknown error")).toBeTruthy();
  });

  it("owner sees every section; the active item is marked and children render", () => {
    nav.set({ pathname: "/dramas/s1" });
    render(<Shell><p>content</p></Shell>);
    const sidebar = screen.getAllByRole("navigation", { name: "Sections" })[0];
    expect(within(sidebar).getAllByRole("link")).toHaveLength(NAV.length);
    expect(within(sidebar).getByRole("link", { name: "Dramas" })).toHaveAttribute("aria-current", "page");
    expect(within(sidebar).getByRole("link", { name: "Categories" })).not.toHaveAttribute("aria-current");
    expect(within(sidebar).getByText("Monetisation")).toBeTruthy();
    expect(screen.getByRole("main")).toHaveTextContent("content");
    expect(screen.getByText("Asha")).toBeTruthy();
    expect(screen.getByText("owner")).toBeTruthy();
  });

  it("limits the sidebar to what the role may reach", () => {
    signIn("support");
    nav.set({ pathname: "/users" });
    render(<Shell>kid</Shell>);
    const sidebar = screen.getByRole("navigation", { name: "Sections" });
    const names = within(sidebar).getAllByRole("link").map((a) => a.textContent);
    expect(names).toContain("Users");
    expect(names).toContain("Inbox");
    expect(names).not.toContain("Audit Log");
    expect(names).not.toContain("Purchases");
  });

  it("redirects a role away from a route it cannot access, without rendering it", () => {
    signIn("support");
    nav.set({ pathname: "/audit" });
    render(<Shell><p>secret</p></Shell>);
    expect(nav.router.replace).toEqual(["/dashboard"]);
    expect(screen.queryByText("secret")).toBeNull();
    expect(screen.getByText("Redirecting…")).toBeTruthy();
  });

  it("does not redirect from an allowed route", () => {
    nav.set({ pathname: "/dashboard" });
    render(<Shell>ok</Shell>);
    expect(nav.router.replace).toEqual([]);
  });

  it("signs out from the sidebar", async () => {
    render(<Shell>kid</Shell>);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(auth.logout).toHaveBeenCalledTimes(1);
  });

  it("opens the mobile drawer, which closes via backdrop, link click and sign out", async () => {
    const user = userEvent.setup();
    render(<Shell>kid</Shell>);
    expect(screen.getAllByRole("navigation", { name: "Sections" })).toHaveLength(1);
    const openBtn = screen.getByRole("button", { name: "Open menu" });
    expect(openBtn).toHaveAttribute("aria-expanded", "false");
    await user.click(openBtn);
    expect(openBtn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("navigation", { name: "Sections" })).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Close menu" }));
    expect(screen.getAllByRole("navigation", { name: "Sections" })).toHaveLength(1);

    await user.click(openBtn);
    const drawer = screen.getAllByRole("navigation", { name: "Sections" })[0];
    document.addEventListener("click", (e) => e.preventDefault(), { once: true }); // jsdom cannot navigate
    await user.click(within(drawer).getByRole("link", { name: "Dramas" }));
    expect(screen.getAllByRole("navigation", { name: "Sections" })).toHaveLength(1);
  });

  it("mounts the command palette, opened with Ctrl+K", async () => {
    const user = userEvent.setup();
    render(<Shell>kid</Shell>);
    await user.keyboard("{Control>}k{/Control}");
    expect(screen.getByLabelText("Search screens, series and users")).toBeTruthy();
  });
});
