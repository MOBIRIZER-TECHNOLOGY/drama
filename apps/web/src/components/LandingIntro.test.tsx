import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";
import { auth, setAuth } from "@/test-utils/auth-context";
import { LandingIntro } from "./LandingIntro";

vi.mock("@/lib/auth-context", () => import("@/test-utils/auth-context"));
beforeEach(() => setAuth());

describe("LandingIntro", () => {
  it.each(["loading", "authenticated"] as const)("renders nothing while %s", (status) => {
    setAuth({ status });
    const { container } = render(<LandingIntro />, { wrapper: appWrapper() });
    expect(container.innerHTML).toBe("");
  });

  it("uses plain copy when config has no economy numbers", () => {
    render(<LandingIntro />, { wrapper: appWrapper() });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Bite-sized dramas in your language.");
    expect(screen.getByText("Create a free account")).toBeTruthy();
    expect(screen.getByText(/Start watching straight away/)).toBeTruthy();
    expect(screen.queryByText(/more episodes, on us/)).toBeNull();
  });

  it("states the real free-episode count, bonus and what it buys", () => {
    render(<LandingIntro />, {
      wrapper: appWrapper({ lang: "hi", config: { economy: { free_episodes: 5, episode_price: 10 }, rewards: { signup_bonus: 55 } } as never }),
    });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("First 5 episodes free");
    expect(screen.getByText(/first 5 episodes of every drama are free/)).toBeTruthy();
    expect(screen.getByText("Get 55 free coins")).toBeTruthy();
    expect(screen.getByText("That is about 5 more episodes, on us.")).toBeTruthy();
    expect(screen.getByText("Start watching").closest("a")!.getAttribute("href")).toBe("/hi/shorts");
    fireEvent.click(screen.getByText("Get 55 free coins"));
    expect(auth.openAuth).toHaveBeenCalled();
  });

  it("a bonus with no episode price shows no episode estimate", () => {
    render(<LandingIntro />, { wrapper: appWrapper({ config: { economy: { free_episodes: 0, episode_price: 0 }, rewards: { signup_bonus: 20 } } as never }) });
    expect(screen.queryByText(/more episodes/)).toBeNull();
  });

  it("film catalogue variant", () => {
    render(<LandingIntro filmCatalogue />, { wrapper: appWrapper() });
    expect(screen.getByText("Short films. Complete stories.")).toBeTruthy();
    expect(screen.getByText("Explore the films").closest("a")!.getAttribute("href")).toBe("/series");
    expect(screen.getByText("Film credits & licences").closest("a")!.getAttribute("href")).toBe("/p/film-credits");
  });
});
