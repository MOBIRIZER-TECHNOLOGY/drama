import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const track = vi.fn();
vi.mock("@/lib/analytics", () => ({ track: (...a: unknown[]) => track(...a) }));

import { PlaybackBeacons } from "./beacons";

let now = 0;
beforeEach(() => {
  now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  track.mockReset();
});
afterEach(() => vi.restoreAllMocks());

const base = { episode_id: "e", series_id: "s", surface: "series" };

describe("PlaybackBeacons", () => {
  it("start emits play_start with the target and default surface", () => {
    new PlaybackBeacons({ episodeId: "e", seriesId: "s" }).start();
    expect(track).toHaveBeenCalledWith("play_start", base);
  });

  it("uses the supplied surface", () => {
    new PlaybackBeacons({ episodeId: "e", seriesId: "s", surface: "shorts" }).start();
    expect(track).toHaveBeenCalledWith("play_start", { ...base, surface: "shorts" });
  });

  it("first playing emits first_frame with ttff, later ones without a stall emit nothing", () => {
    const b = new PlaybackBeacons({ episodeId: "e", seriesId: "s" });
    b.start();
    now = 1450.4;
    b.playing();
    expect(track).toHaveBeenLastCalledWith("first_frame", { ...base, ttff_ms: 450 });
    track.mockClear();
    b.playing();
    expect(track).not.toHaveBeenCalled();
  });

  it("playing without start sends no first_frame", () => {
    const b = new PlaybackBeacons({ episodeId: "e", seriesId: "s" });
    b.playing();
    expect(track).not.toHaveBeenCalled();
  });

  it("measures a rebuffer from waiting to playing, and ignores waiting before the first frame", () => {
    const b = new PlaybackBeacons({ episodeId: "e", seriesId: "s" });
    b.start();
    b.waiting(); // before first frame: ignored
    now = 1100;
    b.playing();
    track.mockClear();
    b.waiting();
    now = 1700;
    b.waiting(); // second waiting must not reset the clock
    now = 2000;
    b.playing();
    expect(track).toHaveBeenCalledWith("rebuffer", { ...base, duration_ms: 900 });
  });

  it("a seek cancels a pending rebuffer and reports the rounded target", () => {
    const b = new PlaybackBeacons({ episodeId: "e", seriesId: "s" });
    b.start();
    b.playing();
    b.waiting();
    b.seek(12.6);
    expect(track).toHaveBeenLastCalledWith("seek", { ...base, to_sec: 13 });
    track.mockClear();
    b.playing();
    expect(track).not.toHaveBeenCalled();
  });

  it("levelSwitch, error and complete (once)", () => {
    const b = new PlaybackBeacons({ episodeId: "e", seriesId: "s" });
    b.levelSwitch(1234.6, 720);
    expect(track).toHaveBeenLastCalledWith("bitrate_switch", { ...base, kbps: 1235, height: 720 });
    b.levelSwitch(500);
    expect(track).toHaveBeenLastCalledWith("bitrate_switch", { ...base, kbps: 500, height: null });
    b.error("boom", true);
    expect(track).toHaveBeenLastCalledWith("play_error", { ...base, code: "boom", fatal: true });
    track.mockClear();
    b.complete();
    b.complete();
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("play_complete", base);
  });

  it("start resets state so a new attempt gets a first_frame and complete again", () => {
    const b = new PlaybackBeacons({ episodeId: "e", seriesId: "s" });
    b.start();
    b.playing();
    b.complete();
    track.mockClear();
    b.start();
    b.playing();
    b.complete();
    expect(track.mock.calls.map((c) => c[0])).toEqual(["play_start", "first_frame", "play_complete"]);
  });
});
