import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";
import { auth, aUser, setAuth } from "@/test-utils/auth-context";
import { resetNav } from "@/test-utils/next-navigation";

vi.mock("next/navigation", () => import("@/test-utils/next-navigation"));
vi.mock("@/lib/auth-context", () => import("@/test-utils/auth-context"));
vi.mock("./SearchBox", () => ({
  SearchBox: ({ autoFocus, onNavigate }: { autoFocus?: boolean; onNavigate?: () => void }) => (
    <button data-testid={autoFocus ? "mobile-search" : "search"} onClick={onNavigate}>
      searchbox
    </button>
  ),
}));

import { Header } from "./Header";

beforeEach(() => {
  resetNav();
  setAuth();
});

describe("Header navigation", () => {
  it("renders brand + primary nav with locale hrefs, highlighting the current route", () => {
    resetNav("/hi/series");
    render(<Header />, { wrapper: appWrapper({ lang: "hi" }) });
    expect(screen.getByLabelText("Katha home").getAttribute("href")).toBe("/hi");
    expect(screen.getByText("Browse").getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Shorts").getAttribute("href")).toBe("/hi/shorts");
    expect(screen.getByText("Home").getAttribute("aria-current")).toBeNull();
  });

  it("toggles the mobile search and closes it when it navigates", () => {
    render(<Header />, { wrapper: appWrapper() });
    expect(screen.queryByTestId("mobile-search")).toBeNull();
    const toggle = screen.getByLabelText("Search");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByTestId("mobile-search"));
    expect(screen.queryByTestId("mobile-search")).toBeNull();
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(screen.queryByTestId("mobile-search")).toBeNull();
  });
});

describe("Header auth states", () => {
  it("shows a skeleton while loading", () => {
    setAuth({ status: "loading" });
    const { container } = render(<Header />, { wrapper: appWrapper() });
    expect(container.querySelector(".k-skeleton")).not.toBeNull();
  });

  it("anonymous: sign-up CTA opens the dialog, mentioning the bonus when there is one", () => {
    const a = render(<Header />, { wrapper: appWrapper() });
    expect(screen.getByText("Sign up free")).toBeTruthy();
    fireEvent.click(screen.getByText("Sign in").closest("button")!);
    expect(auth.openAuth).toHaveBeenCalled();
    a.unmount();
    render(<Header />, { wrapper: appWrapper({ config: { rewards: { signup_bonus: 50 } } as never }) });
    expect(screen.getByText("Get 50 free coins")).toBeTruthy();
  });

  it("authenticated: shows the formatted balance and a letter avatar", () => {
    setAuth({ status: "authenticated", user: aUser, balance: 12500 });
    render(<Header />, { wrapper: appWrapper() });
    expect(screen.getByLabelText("Coin balance").textContent).toBe("12,500");
    expect(screen.getByLabelText("Coin balance").getAttribute("href")).toBe("/wallet");
    expect(screen.getByLabelText("Account").textContent).toBe("A");
  });

  it("avatar falls back to email initial, then '?', and uses the image when present", () => {
    setAuth({ status: "authenticated", user: { ...aUser, display_name: null } as never });
    const a = render(<Header />, { wrapper: appWrapper() });
    expect(screen.getByLabelText("Account").textContent).toBe("a");
    a.unmount();
    setAuth({ status: "authenticated", user: { ...aUser, display_name: null, email: null } as never });
    const b = render(<Header />, { wrapper: appWrapper() });
    expect(screen.getByLabelText("Account").textContent).toBe("?");
    b.unmount();
    setAuth({ status: "authenticated", user: { ...aUser, avatar_url: "https://cdn.example.com/a.png" } as never });
    render(<Header />, { wrapper: appWrapper() });
    expect(screen.getByLabelText("Account").querySelector("img")).not.toBeNull();
  });

  it("account menu opens, lists links, closes on outside click and Escape, and signs out", () => {
    setAuth({ status: "authenticated", user: { ...aUser, email: null, phone: "+911234" } as never });
    render(<Header />, { wrapper: appWrapper({ lang: "hi" }) });
    const btn = screen.getByLabelText("Account");
    expect(screen.queryByRole("navigation", { name: "Account" })).toBeNull();
    fireEvent.click(btn);
    const menu = screen.getByRole("navigation", { name: "Account" });
    expect(menu.textContent).toContain("+911234");
    expect(screen.getByText("Profile").closest("a")!.getAttribute("href")).toBe("/hi/profile");
    expect(screen.getByText("Wallet").closest("a")!.getAttribute("href")).toBe("/hi/wallet");
    fireEvent.mouseDown(menu);
    expect(screen.queryByRole("navigation", { name: "Account" })).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("navigation", { name: "Account" })).toBeNull();
    fireEvent.click(btn);
    fireEvent.keyDown(document, { key: "a" });
    expect(screen.queryByRole("navigation", { name: "Account" })).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("navigation", { name: "Account" })).toBeNull();
    fireEvent.click(btn);
    fireEvent.click(screen.getByText("Sign out"));
    expect(auth.signOut).toHaveBeenCalled();
  });

  it("menu falls back to the anonymous label and public id", () => {
    setAuth({ status: "authenticated", user: { ...aUser, display_name: null, email: null, phone: null, public_id: "PUB1" } as never });
    render(<Header />, { wrapper: appWrapper() });
    fireEvent.click(screen.getByLabelText("Account"));
    expect(screen.getByText("Katha viewer")).toBeTruthy();
    expect(screen.getByText("PUB1")).toBeTruthy();
  });

  it("authenticated status without a user object still shows the sign-up control", () => {
    setAuth({ status: "authenticated", user: null });
    render(<Header />, { wrapper: appWrapper() });
    expect(screen.getByText("Sign up free")).toBeTruthy();
  });
});
