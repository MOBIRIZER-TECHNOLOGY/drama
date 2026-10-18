import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";
import { auth, setAuth } from "@/test-utils/auth-context";
import * as guestHistory from "@/lib/guest-history";
import { GuestContinue } from "./GuestContinue";

vi.mock("@/lib/auth-context", () => import("@/test-utils/auth-context"));

const watch = (id: string, cover: string | null = "https://cdn.example.com/c.jpg") => ({
  seriesId: id,
  slug: `show-${id}`,
  title: `Show ${id}`,
  coverUrl: cover,
  episodeNumber: 3,
  positionSec: 40,
});

beforeEach(() => {
  setAuth({ status: "anonymous" });
  guestHistory.clear();
});

describe("GuestContinue", () => {
  it("renders nothing without history", () => {
    const { container } = render(<GuestContinue />, { wrapper: appWrapper() });
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for signed-in or loading viewers even with history", () => {
    guestHistory.record(watch("a"));
    setAuth({ status: "authenticated" });
    const a = render(<GuestContinue />, { wrapper: appWrapper() });
    expect(a.container.innerHTML).toBe("");
    a.unmount();
    setAuth({ status: "loading" });
    const b = render(<GuestContinue />, { wrapper: appWrapper() });
    expect(b.container.innerHTML).toBe("");
  });

  it("lists watches linking to the episode, with and without covers, and updates live", () => {
    guestHistory.record(watch("a"));
    guestHistory.record(watch("b", null));
    render(<GuestContinue />, { wrapper: appWrapper({ lang: "hi" }) });
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe("/hi/series/show-b/3");
    expect(links[0].getAttribute("aria-label")).toBe("Show b · episode 3");
    expect(links[0].querySelector("img")).toBeNull();
    expect(links[1].querySelector("img")).not.toBeNull();
    act(() => guestHistory.remove("a"));
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("offers to save across devices by opening sign-in", () => {
    guestHistory.record(watch("a"));
    render(<GuestContinue />, { wrapper: appWrapper() });
    fireEvent.click(screen.getByText("Save across devices"));
    expect(auth.openAuth).toHaveBeenCalled();
  });
});
