import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";
import { makeCategory, makeSeries } from "@/test-utils/fixtures";
import { nav, resetNav } from "@/test-utils/next-navigation";

vi.mock("next/navigation", () => import("@/test-utils/next-navigation"));
const GET = vi.fn();
vi.mock("@/lib/client-api", () => ({ clientApi: { GET: (...a: unknown[]) => GET(...a) } }));
const track = vi.fn();
vi.mock("@/lib/analytics", () => ({ track: (...a: unknown[]) => track(...a) }));

import { SearchBox } from "./SearchBox";

const ok = (data: unknown) => ({ data, response: { ok: true, status: 200 } });
const input = () => screen.getByRole("combobox") as HTMLInputElement;
const typeQ = (v: string) => fireEvent.change(input(), { target: { value: v } });
const settle = async (ms = 250) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  resetNav();
  GET.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("SearchBox", () => {
  it("does not search for fewer than two characters", async () => {
    render(<SearchBox />, { wrapper: appWrapper() });
    typeQ("a");
    await settle();
    expect(GET).not.toHaveBeenCalled();
    expect(input().getAttribute("aria-expanded")).toBe("false");
  });

  it("debounces, then shows results with a loading state in between", async () => {
    GET.mockResolvedValue(ok([makeSeries({ categories: [makeCategory()] }), makeSeries({ id: "s2", slug: "two", title: "Two", cover_url: null, categories: [] })]));
    render(<SearchBox />, { wrapper: appWrapper({ lang: "hi" }) });
    typeQ("lo");
    typeQ("love");
    expect(screen.getByText("Loading…")).toBeTruthy();
    await settle(249);
    expect(GET).not.toHaveBeenCalled();
    await settle(1);
    expect(GET).toHaveBeenCalledTimes(1);
    expect(GET.mock.calls[0][1].params.query).toEqual({ q: "love", lang: "hi", limit: 8 });
    expect(screen.getByText("My Show").closest("a")!.getAttribute("href")).toBe("/hi/series/my-show");
    expect(screen.getByText("10 episodes · Romance")).toBeTruthy();
    expect(screen.getByText("10 episodes", { exact: true })).toBeTruthy();
  });

  it("shows empty and error states", async () => {
    GET.mockResolvedValueOnce(ok([]));
    const { unmount } = render(<SearchBox />, { wrapper: appWrapper() });
    typeQ("zzz");
    await settle();
    expect(screen.getByText("No dramas match that.")).toBeTruthy();
    unmount();
    GET.mockResolvedValueOnce({ error: { detail: "Search is down" }, response: { ok: false, status: 500 } });
    render(<SearchBox />, { wrapper: appWrapper() });
    typeQ("zzz");
    await settle();
    expect(screen.getByText("Search is down")).toBeTruthy();
  });

  it("drops a stale response when the query changes", async () => {
    let first!: (v: unknown) => void;
    GET.mockReturnValueOnce(new Promise((r) => (first = r)));
    GET.mockResolvedValueOnce(ok([makeSeries({ title: "Fresh" })]));
    render(<SearchBox />, { wrapper: appWrapper() });
    typeQ("old");
    await settle();
    typeQ("newer");
    await settle();
    await act(async () => first(ok([makeSeries({ title: "Stale" })])));
    expect(screen.queryByText("Stale")).toBeNull();
    expect(screen.getByText("Fresh")).toBeTruthy();
  });

  it("submits on Enter: tracks, closes, navigates with an encoded query and calls onNavigate", async () => {
    GET.mockResolvedValue(ok([makeSeries()]));
    const onNavigate = vi.fn();
    render(<SearchBox onNavigate={onNavigate} />, { wrapper: appWrapper({ lang: "hi" }) });
    typeQ("love & war");
    await settle();
    fireEvent.submit(input().closest("form")!);
    expect(track).toHaveBeenCalledWith("search", { q: "love & war", results: 1, surface: "box" });
    expect(nav.router.push).toHaveBeenCalledWith("/hi/search?q=love%20%26%20war");
    expect(onNavigate).toHaveBeenCalled();
    expect(input().getAttribute("aria-expanded")).toBe("false");
  });

  it("submitting before results arrive reports null results; blank submit does nothing", () => {
    render(<SearchBox />, { wrapper: appWrapper() });
    fireEvent.submit(input().closest("form")!);
    expect(nav.router.push).not.toHaveBeenCalled();
    typeQ("ab");
    fireEvent.submit(input().closest("form")!);
    expect(track).toHaveBeenCalledWith("search", { q: "ab", results: null, surface: "box" });
  });

  it("'See all results' navigates like submit; picking a result closes the panel", async () => {
    GET.mockResolvedValue(ok([makeSeries()]));
    const onNavigate = vi.fn();
    render(<SearchBox onNavigate={onNavigate} />, { wrapper: appWrapper() });
    typeQ("love");
    await settle();
    fireEvent.click(screen.getByText(/See all results for/));
    expect(nav.router.push).toHaveBeenCalledWith("/search?q=love");
    fireEvent.focus(input());
    fireEvent.click(screen.getByText("My Show"));
    expect(onNavigate).toHaveBeenCalledTimes(2);
    expect(input().getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on an outside mousedown and reopens on focus", async () => {
    GET.mockResolvedValue(ok([makeSeries()]));
    render(<SearchBox />, { wrapper: appWrapper() });
    typeQ("love");
    await settle();
    expect(input().getAttribute("aria-expanded")).toBe("true");
    fireEvent.mouseDown(input());
    expect(input().getAttribute("aria-expanded")).toBe("true");
    fireEvent.mouseDown(document.body);
    expect(input().getAttribute("aria-expanded")).toBe("false");
    fireEvent.focus(input());
    expect(input().getAttribute("aria-expanded")).toBe("true");
  });

  it("honours autoFocus", () => {
    render(<SearchBox autoFocus />, { wrapper: appWrapper() });
    expect(document.activeElement).toBe(input());
  });
});
