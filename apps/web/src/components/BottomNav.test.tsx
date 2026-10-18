import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";
import { auth, aUser, setAuth } from "@/test-utils/auth-context";
import { resetNav } from "@/test-utils/next-navigation";
import { BottomNav } from "./BottomNav";

vi.mock("next/navigation", () => import("@/test-utils/next-navigation"));
vi.mock("@/lib/auth-context", () => import("@/test-utils/auth-context"));

beforeEach(() => {
  resetNav();
  setAuth();
});

describe("BottomNav", () => {
  it("hides on the shorts route (with or without a language prefix)", () => {
    resetNav("/shorts");
    const a = render(<BottomNav />, { wrapper: appWrapper() });
    expect(a.container.innerHTML).toBe("");
    a.unmount();
    resetNav("/hi/shorts");
    const b = render(<BottomNav />, { wrapper: appWrapper({ lang: "hi" }) });
    expect(b.container.innerHTML).toBe("");
  });

  it("marks the current tab and prefixes hrefs by language", () => {
    resetNav("/hi/rewards");
    render(<BottomNav />, { wrapper: appWrapper({ lang: "hi" }) });
    const rewards = screen.getByText("Rewards").closest("a")!;
    expect(rewards.getAttribute("aria-current")).toBe("page");
    expect(rewards.getAttribute("href")).toBe("/hi/rewards");
    expect(screen.getByText("Home").closest("a")!.getAttribute("href")).toBe("/hi");
    expect(screen.getByText("Home").closest("a")!.getAttribute("aria-current")).toBeNull();
  });

  it("offers sign-in to anonymous viewers", () => {
    render(<BottomNav />, { wrapper: appWrapper() });
    fireEvent.click(screen.getByText("Sign in"));
    expect(auth.openAuth).toHaveBeenCalled();
  });

  it("links to the profile when authenticated and highlights it there", () => {
    setAuth({ status: "authenticated", user: aUser });
    const { unmount } = render(<BottomNav />, { wrapper: appWrapper() });
    const me = screen.getByText("Me").closest("a")!;
    expect(me.getAttribute("href")).toBe("/profile");
    expect(me.getAttribute("aria-current")).toBeNull();
    unmount();
    resetNav("/profile");
    render(<BottomNav />, { wrapper: appWrapper() });
    expect(screen.getByText("Me").closest("a")!.getAttribute("aria-current")).toBe("page");
  });
});
