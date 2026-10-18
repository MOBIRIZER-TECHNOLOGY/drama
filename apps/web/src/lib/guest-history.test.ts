import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as gh from "./guest-history";

const entry = (id: string, pos = 30) => ({
  seriesId: id,
  slug: `s-${id}`,
  title: `T${id}`,
  coverUrl: null,
  episodeNumber: 1,
  positionSec: pos,
});

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("guest-history", () => {
  it("ignores watches shorter than 15 seconds", () => {
    gh.record(entry("a", 14));
    expect(gh.getSnapshot()).toEqual([]);
  });

  it("upserts newest first, flooring the position, replacing earlier episodes of a series", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    gh.record(entry("a", 20.9));
    gh.record(entry("b"));
    gh.record({ ...entry("a", 99), episodeNumber: 3 });
    const rows = gh.getSnapshot();
    expect(rows.map((r) => r.seriesId)).toEqual(["a", "b"]);
    expect(rows[0]).toMatchObject({ episodeNumber: 3, positionSec: 99, updatedAt: 1000 });
  });

  it("caps at 12 entries", () => {
    for (let i = 0; i < 15; i++) gh.record(entry(String(i)));
    expect(gh.getSnapshot()).toHaveLength(12);
    expect(gh.getSnapshot()[0].seriesId).toBe("14");
  });

  it("returns an identical array until storage changes", () => {
    gh.record(entry("a"));
    expect(gh.getSnapshot()).toBe(gh.getSnapshot());
  });

  it("removes and clears, notifying subscribers", () => {
    const cb = vi.fn();
    const off = gh.subscribe(cb);
    gh.record(entry("a"));
    gh.record(entry("b"));
    gh.remove("a");
    expect(gh.getSnapshot().map((r) => r.seriesId)).toEqual(["b"]);
    gh.clear();
    expect(gh.getSnapshot()).toEqual([]);
    expect(cb).toHaveBeenCalledTimes(4);
    off();
    gh.clear();
    expect(cb).toHaveBeenCalledTimes(4);
  });

  it("reacts to storage events for its key or a full clear, not others", () => {
    const cb = vi.fn();
    const off = gh.subscribe(cb);
    window.dispatchEvent(new StorageEvent("storage", { key: "katha.guest_history" }));
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    window.dispatchEvent(new StorageEvent("storage", { key: "other" }));
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("filters malformed stored rows and tolerates garbage", () => {
    window.localStorage.setItem(
      "katha.guest_history",
      JSON.stringify([entry("ok"), null, "x", { seriesId: 1 }, { seriesId: "a", slug: "s" }]),
    );
    expect(gh.getSnapshot().map((r) => r.seriesId)).toEqual(["ok"]);
    window.localStorage.setItem("katha.guest_history", "{not json");
    expect(gh.getSnapshot()).toEqual([]);
    window.localStorage.setItem("katha.guest_history", '{"a":1}');
    expect(gh.getSnapshot()).toEqual([]);
  });

  it("copes with unreadable and unwritable storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    const cb = vi.fn();
    gh.subscribe(cb);
    expect(gh.getSnapshot()).toEqual([]);
    expect(() => gh.record(entry("a"))).not.toThrow();
    expect(cb).toHaveBeenCalled();
  });

  it("server snapshot is a stable empty array", () => {
    expect(gh.getServerSnapshot()).toBe(gh.getServerSnapshot());
    expect(gh.getServerSnapshot()).toEqual([]);
  });
});
