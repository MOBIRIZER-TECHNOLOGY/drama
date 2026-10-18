import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";
import { makeCategory } from "@/test-utils/fixtures";
import { SearchSuggestions, rememberSearch } from "./SearchSuggestions";

const KEY = "katha.recent_searches";
const w = { wrapper: appWrapper({ lang: "hi" }) };
const stored = () => JSON.parse(window.localStorage.getItem(KEY) ?? "null");

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("rememberSearch", () => {
  it("stores newest first, de-duplicating case-insensitively and capping at 8", () => {
    for (const q of ["a", "b", "c", "d", "e", "f", "g", "h", "i"]) rememberSearch(q);
    expect(stored()).toEqual(["i", "h", "g", "f", "e", "d", "c", "b"]);
    rememberSearch("  C ");
    expect(stored()[0]).toBe("C");
    expect(stored().filter((x: string) => x.toLowerCase() === "c")).toHaveLength(1);
  });
  it("ignores blank terms and survives storage failures", () => {
    rememberSearch("   ");
    expect(stored()).toBeNull();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(() => rememberSearch("x")).not.toThrow();
  });
  it("is a no-op on the server", () => {
    vi.stubGlobal("window", undefined);
    try {
      expect(() => rememberSearch("x")).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("SearchSuggestions", () => {
  it("shows an empty hint with no history and no genres", () => {
    render(<SearchSuggestions categories={[]} />, w);
    expect(screen.getByText("Try a title, a genre or a mood.")).toBeTruthy();
  });

  it("lists genres as locale links", () => {
    render(<SearchSuggestions categories={[makeCategory()]} />, w);
    expect(screen.getByText("Romance").closest("a")!.getAttribute("href")).toBe("/hi/category/romance");
    expect(screen.queryByText("Recent searches")).toBeNull();
    expect(screen.queryByText("Try a title, a genre or a mood.")).toBeNull();
  });

  it("lists recent searches, updates live when one is remembered, and clears", () => {
    window.localStorage.setItem(KEY, JSON.stringify(["love", 5, "war"]));
    render(<SearchSuggestions categories={[]} />, w);
    expect(screen.getByText("love").closest("a")!.getAttribute("href")).toBe("/hi/search?q=love");
    expect(screen.getByText("war")).toBeTruthy();
    act(() => rememberSearch("new & old"));
    expect(screen.getByText("new & old").closest("a")!.getAttribute("href")).toBe("/hi/search?q=new%20%26%20old");
    fireEvent.click(screen.getByText("Clear"));
    expect(screen.queryByText("Recent searches")).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("tolerates corrupt or non-array storage and reacts to cross-tab changes", () => {
    window.localStorage.setItem(KEY, "{bad");
    render(<SearchSuggestions categories={[]} />, w);
    expect(screen.getByText("Try a title, a genre or a mood.")).toBeTruthy();
    act(() => {
      window.localStorage.setItem(KEY, '{"a":1}');
      window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    });
    expect(screen.getByText("Try a title, a genre or a mood.")).toBeTruthy();
    act(() => {
      window.localStorage.setItem(KEY, '["other tab"]');
      window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    });
    expect(screen.getByText("other tab")).toBeTruthy();
  });

  it("copes with unreadable and un-clearable storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    render(<SearchSuggestions categories={[]} />, w);
    expect(screen.getByText("Try a title, a genre or a mood.")).toBeTruthy();
  });

  it("clear survives a throwing removeItem", () => {
    window.localStorage.setItem(KEY, '["x"]');
    render(<SearchSuggestions categories={[]} />, w);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => fireEvent.click(screen.getByText("Clear"))).not.toThrow();
  });
});
