import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";
import { makeCategory, makeSeries } from "@/test-utils/fixtures";
import { HeroCarousel } from "./HeroCarousel";

const items = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    makeSeries({ id: `s${i}`, slug: `show-${i}`, title: `Show ${i}`, banner_url: i === 0 ? null : `https://cdn.example.com/b${i}.jpg`, categories: [makeCategory({ id: `c${i}`, name: `Cat ${i}` })], episode_count: i === 0 ? 1 : 12, synopsis: i === 1 ? null : "syn" }),
  );
const w = { wrapper: appWrapper({ lang: "hi" }) };
const slides = (c: HTMLElement) => Array.from(c.querySelectorAll('[aria-roledescription="slide"]'));
const activeTitle = (c: HTMLElement) => slides(c).find((s) => s.getAttribute("aria-hidden") === "false")!.querySelector("h2")!.textContent;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("HeroCarousel", () => {
  it("renders nothing without items", () => {
    const { container } = render(<HeroCarousel items={[]} />, w);
    expect(container.innerHTML).toBe("");
  });

  it("a single slide has no controls and no autoplay", () => {
    const { container } = render(<HeroCarousel items={items(1)} />, w);
    expect(screen.queryByLabelText("Next")).toBeNull();
    expect(screen.queryByLabelText("Pause slideshow")).toBeNull();
    act(() => void vi.advanceTimersByTime(20_000));
    expect(activeTitle(container)).toBe("Show 0");
    expect(screen.getByText("1 Episode")).toBeTruthy();
    expect(screen.getByText("Watch now").closest("a")!.getAttribute("href")).toBe("/hi/series/show-0?ep=1");
    expect(screen.getByText("Details").closest("a")!.getAttribute("href")).toBe("/hi/series/show-0");
  });

  it("auto-advances every 6s and wraps around", () => {
    const { container } = render(<HeroCarousel items={items(3)} />, w);
    expect(activeTitle(container)).toBe("Show 0");
    act(() => void vi.advanceTimersByTime(6000));
    expect(activeTitle(container)).toBe("Show 1");
    act(() => void vi.advanceTimersByTime(6000));
    expect(activeTitle(container)).toBe("Show 2");
    act(() => void vi.advanceTimersByTime(6000));
    expect(activeTitle(container)).toBe("Show 0");
  });

  it("prev/next buttons and dots navigate, wrapping at both ends", () => {
    const { container } = render(<HeroCarousel items={items(4)} />, w);
    fireEvent.click(screen.getByLabelText("Previous"));
    expect(activeTitle(container)).toBe("Show 3");
    fireEvent.click(screen.getByLabelText("Next"));
    expect(activeTitle(container)).toBe("Show 0");
    fireEvent.click(screen.getByLabelText("Slide 3 of 4"));
    expect(activeTitle(container)).toBe("Show 2");
    expect(screen.getByLabelText("Slide 3 of 4").getAttribute("aria-current")).toBe("true");
  });

  it("only mounts the active slide and its neighbours when there are more than three", () => {
    const { container } = render(<HeroCarousel items={items(8)} />, w);
    expect(slides(container)).toHaveLength(3); // 0, 1 and the wrapped 7
    fireEvent.click(screen.getByLabelText("Slide 5 of 8"));
    expect(slides(container)).toHaveLength(3);
    expect(slides(container).map((s) => s.getAttribute("aria-label"))).toEqual(["4 / 8", "5 / 8", "6 / 8"]);
    const small = render(<HeroCarousel items={items(3)} />, w);
    expect(slides(small.container)).toHaveLength(3);
  });

  it("pauses on hover/focus and when the viewer pauses; resumes after", () => {
    const { container } = render(<HeroCarousel items={items(3)} />, w);
    const section = container.querySelector("section")!;
    fireEvent.mouseEnter(section);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(activeTitle(container)).toBe("Show 0");
    expect(container.querySelector("[aria-live]")!.getAttribute("aria-live")).toBe("polite");
    fireEvent.mouseLeave(section);
    act(() => void vi.advanceTimersByTime(6000));
    expect(activeTitle(container)).toBe("Show 1");
    fireEvent.focusIn(section);
    fireEvent.focus(screen.getByLabelText("Next"));
    act(() => void vi.advanceTimersByTime(10_000));
    expect(activeTitle(container)).toBe("Show 1");
    fireEvent.blur(screen.getByLabelText("Next"));
    fireEvent.click(screen.getByLabelText("Pause slideshow"));
    act(() => void vi.advanceTimersByTime(10_000));
    expect(activeTitle(container)).toBe("Show 1");
    expect(screen.getByLabelText("Resume slideshow").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByLabelText("Resume slideshow"));
    act(() => void vi.advanceTimersByTime(6000));
    expect(activeTitle(container)).toBe("Show 2");
  });

  it("does not autoplay under prefers-reduced-motion", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
    const { container } = render(<HeroCarousel items={items(3)} />, w);
    act(() => void vi.advanceTimersByTime(20_000));
    expect(activeTitle(container)).toBe("Show 0");
  });

  it("swipes: left advances, right goes back, small moves are ignored, a stray touchend is ignored", () => {
    const { container } = render(<HeroCarousel items={items(3)} />, w);
    const section = container.querySelector("section")!;
    const swipe = (from: number, to: number) => {
      fireEvent.touchStart(section, { touches: [{ clientX: from }] });
      fireEvent.touchEnd(section, { changedTouches: [{ clientX: to }] });
    };
    swipe(200, 100);
    expect(activeTitle(container)).toBe("Show 1");
    swipe(100, 200);
    expect(activeTitle(container)).toBe("Show 0");
    swipe(100, 120);
    expect(activeTitle(container)).toBe("Show 0");
    fireEvent.touchEnd(section, { changedTouches: [{ clientX: 0 }] });
    expect(activeTitle(container)).toBe("Show 0");
  });

  it("shows up to three category chips, plural episode counts, and optional synopsis", () => {
    const many = items(2);
    many[0].categories = Array.from({ length: 5 }, (_, i) => makeCategory({ id: `x${i}`, name: `G${i}` }));
    render(<HeroCarousel items={many} />, w);
    expect(screen.queryByText("G3")).toBeNull();
    expect(screen.getByText("G2")).toBeTruthy();
    expect(screen.getByText("12 episodes")).toBeTruthy();
  });
});
