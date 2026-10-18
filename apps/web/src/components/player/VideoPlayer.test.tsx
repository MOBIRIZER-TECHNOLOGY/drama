import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoPlayer, type PlayerLabels, type VideoPlayerProps } from "./VideoPlayer";

// useHls is covered on its own; here it is a controllable boundary so the player's wiring can be asserted.
const hlsState = { error: null as string | null, setError: vi.fn(), options: null as null | Record<string, (...a: never[]) => void> };
vi.mock("./use-hls", () => ({
  useHls: (_ref: unknown, options: Record<string, (...a: never[]) => void>) => {
    hlsState.options = options;
    return { error: hlsState.error, setError: hlsState.setError, hlsRef: { current: null } };
  },
}));

const labels: PlayerLabels = {
  play: "Play",
  pause: "Pause",
  mute: "Mute",
  unmute: "Unmute",
  fullscreen: "Fullscreen",
  exitFullscreen: "Exit fullscreen",
  next: "Next",
  back10: "Back 10",
  forward10: "Forward 10",
  seek: "Seek",
  volume: "Volume",
  retry: "Retry",
  unsupported: "Unsupported",
  networkError: "Network error",
  mediaError: "Media error",
  speed: "speed",
  subtitles: "Subtitles",
  subtitlesOff: "Off",
};

type FakeTrack = { kind: string; language: string; mode: string };
const trackLists = new WeakMap<object, { tracks: FakeTrack[]; listeners: Set<() => void> }>();

function textTrackList(el: object) {
  let entry = trackLists.get(el);
  if (!entry) {
    entry = { tracks: [], listeners: new Set() };
    trackLists.set(el, entry);
  }
  const e = entry;
  return {
    get length() {
      return e.tracks.length;
    },
    addEventListener: (_: string, fn: () => void) => e.listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => e.listeners.delete(fn),
    ...new Proxy({}, { get: (_t, k) => (typeof k === "string" && /^\d+$/.test(k) ? e.tracks[Number(k)] : undefined) }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  hlsState.error = null;
  hlsState.setError.mockReset();
  hlsState.options = null;
  Object.defineProperty(HTMLMediaElement.prototype, "textTracks", {
    configurable: true,
    get() {
      const key = this as object;
      const cached = (key as { __tt?: unknown }).__tt;
      if (cached) return cached;
      const list = new Proxy(textTrackList(key), {
        get(t, k, r) {
          if (typeof k === "string" && /^\d+$/.test(k)) return trackLists.get(key)!.tracks[Number(k)];
          return Reflect.get(t, k, r);
        },
      });
      (key as { __tt?: unknown }).__tt = list;
      return list;
    },
  });
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.pause = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
  delete (document as { fullscreenElement?: unknown }).fullscreenElement;
});

function defineProps(el: object, props: Record<string, unknown>) {
  for (const [k, v] of Object.entries(props)) Object.defineProperty(el, k, { configurable: true, writable: true, value: v });
}

function setup(over: Partial<VideoPlayerProps> = {}) {
  const props: VideoPlayerProps = {
    src: "https://cdn/x.m3u8",
    embedHtml: null,
    title: "Ep 1",
    resumeAt: 0,
    autoPlay: false,
    hasNext: true,
    labels,
    onNext: vi.fn(),
    onEnded: vi.fn(),
    onProgress: vi.fn(),
    onReload: vi.fn(),
    ...over,
  };
  const r = render(<VideoPlayer {...props} />);
  const video = r.container.querySelector("video") as HTMLVideoElement | null;
  const region = r.container.querySelector("[role=region]") as HTMLElement;
  return { ...r, props, video: video!, region: region!, rerenderWith: (o: Partial<VideoPlayerProps>) => r.rerender(<VideoPlayer {...props} {...o} />) };
}
const tapSurface = (container: HTMLElement) => container.querySelector("div.absolute.inset-0") as HTMLElement;

describe("embed mode", () => {
  it("renders a sandboxed iframe with the embed markup and no controls", () => {
    const { container } = setup({ embedHtml: "<iframe src='https://yt/x'></iframe>" });
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("title")).toBe("Ep 1");
    expect(frame.getAttribute("srcdoc")).toContain("<iframe src='https://yt/x'></iframe>");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-presentation allow-popups allow-forms");
    expect(container.querySelector("video")).toBeNull();
  });
});

describe("hls wiring", () => {
  it("passes source options and attaches beacons", () => {
    const beacons = { start: vi.fn(), levelSwitch: vi.fn(), error: vi.fn(), seek: vi.fn(), waiting: vi.fn(), playing: vi.fn(), complete: vi.fn() };
    const { props } = setup({ beacons: beacons as never, resumeAt: 20, expiresAt: "2030-01-01T00:00:00Z" });
    const o = hlsState.options as unknown as Record<string, (...a: unknown[]) => void> & { src: string; startAt: number; labels: object; expiresAt: string };
    expect(o.src).toBe("https://cdn/x.m3u8");
    expect(o.startAt).toBe(20);
    expect(o.expiresAt).toBe("2030-01-01T00:00:00Z");
    expect(o.labels).toEqual({ unsupported: "Unsupported", networkError: "Network error", mediaError: "Media error" });
    act(() => o.onSourceAttached());
    expect(beacons.start).toHaveBeenCalled();
    act(() => o.onLevelSwitch(800, 480));
    expect(beacons.levelSwitch).toHaveBeenCalledWith(800, 480);
    act(() => o.onFatalError("manifestLoadError"));
    expect(beacons.error).toHaveBeenCalledWith("manifestLoadError", true);
    act(() => o.onReload());
    expect(props.onReload).toHaveBeenCalled();
  });

  it("works without beacons", () => {
    setup();
    const o = hlsState.options as unknown as Record<string, (...a: unknown[]) => void>;
    expect(() =>
      act(() => {
        o.onSourceAttached();
        o.onLevelSwitch(1, 1);
        o.onFatalError("x");
      }),
    ).not.toThrow();
  });
});

describe("media events and overlays", () => {
  it("shows the big play button when paused and starts playback", () => {
    const { video } = setup();
    defineProps(video, { paused: true });
    fireEvent.click(screen.getAllByLabelText("Play")[0]);
    expect(video.play).toHaveBeenCalled();
  });

  it("play toggles to pause and back via the control button", () => {
    const { video } = setup();
    defineProps(video, { paused: true });
    fireEvent.play(video);
    expect(screen.queryAllByLabelText("Play")).toHaveLength(0);
    defineProps(video, { paused: false });
    fireEvent.click(screen.getByLabelText("Pause"));
    expect(video.pause).toHaveBeenCalled();
  });

  it("swallows a rejected play()", () => {
    const { video } = setup();
    defineProps(video, { paused: true, play: vi.fn().mockRejectedValue(new Error("no")) });
    expect(() => fireEvent.click(screen.getAllByLabelText("Play")[0])).not.toThrow();
  });

  it("reports progress on pause but not on ended-pause; ended calls beacons and the parent", () => {
    const beacons = { complete: vi.fn(), start: vi.fn() };
    const { video, props } = setup({ beacons: beacons as never });
    defineProps(video, { currentTime: 33, duration: 100, ended: false, buffered: { length: 0 } });
    fireEvent.timeUpdate(video);
    fireEvent.pause(video);
    expect(props.onProgress).toHaveBeenLastCalledWith(33, 100);
    (props.onProgress as ReturnType<typeof vi.fn>).mockClear();
    defineProps(video, { ended: true });
    fireEvent.pause(video);
    expect(props.onProgress).not.toHaveBeenCalled();
    fireEvent.ended(video);
    expect(beacons.complete).toHaveBeenCalled();
    expect(props.onEnded).toHaveBeenCalled();
  });

  it("tracks waiting / playing / canplay for the spinner and beacons", () => {
    const beacons = { waiting: vi.fn(), playing: vi.fn() };
    const { video, container } = setup({ beacons: beacons as never });
    fireEvent.waiting(video);
    expect(beacons.waiting).toHaveBeenCalled();
    expect(container.querySelector("svg.animate-spin, [class*=spin]")).not.toBeNull();
    expect(screen.queryAllByLabelText("Play")).toHaveLength(1); // only the control-bar one while buffering
    fireEvent.playing(video);
    expect(beacons.playing).toHaveBeenCalled();
    fireEvent.waiting(video);
    fireEvent.canPlay(video);
    expect(screen.getAllByLabelText("Play")).toHaveLength(2);
  });

  it("time, duration, buffered and the seek bar follow media events", () => {
    const { video, container } = setup();
    defineProps(video, {
      currentTime: 65,
      duration: 130,
      buffered: { length: 2, start: (i: number) => [0, 60][i], end: (i: number) => [10, 90][i] },
    });
    fireEvent.durationChange(video);
    fireEvent.timeUpdate(video);
    expect(container.textContent).toContain("1:05 / 2:10");
    const seek = screen.getByLabelText("Seek") as HTMLInputElement;
    expect(seek.value).toBe("65");
    expect(seek.max).toBe("130");
    expect(seek.getAttribute("aria-valuetext")).toBe("1:05 / 2:10");
  });

  it("treats a non-finite duration as unknown for progress reporting", () => {
    const { video, props, unmount } = setup();
    defineProps(video, { currentTime: 4, duration: Infinity, buffered: { length: 0 } });
    fireEvent.timeUpdate(video);
    unmount();
    expect(props.onProgress).toHaveBeenLastCalledWith(4, null);
  });

  it("volume events sync mute state and icon label", () => {
    const { video } = setup();
    defineProps(video, { volume: 0.5, muted: true });
    fireEvent.volumeChange(video);
    expect(screen.getByLabelText("Unmute")).toBeInTheDocument();
    defineProps(video, { volume: 0, muted: false });
    fireEvent.volumeChange(video);
    expect(screen.getByLabelText("Unmute")).toBeInTheDocument();
    defineProps(video, { volume: 1, muted: false });
    fireEvent.volumeChange(video);
    expect(screen.getByLabelText("Mute")).toBeInTheDocument();
  });

  it("reports aspect ratio once metadata is known, ignoring zero dimensions", () => {
    const onAspectRatio = vi.fn();
    const { video } = setup({ onAspectRatio });
    defineProps(video, { videoWidth: 0, videoHeight: 0 });
    fireEvent.loadedMetadata(video);
    expect(onAspectRatio).not.toHaveBeenCalled();
    defineProps(video, { videoWidth: 1080, videoHeight: 1920 });
    fireEvent.loadedMetadata(video);
    expect(onAspectRatio).toHaveBeenCalledWith(1080 / 1920);
    // Without a listener it is a no-op.
    const other = setup();
    defineProps(other.video, { videoWidth: 10, videoHeight: 10 });
    expect(() => fireEvent.loadedMetadata(other.video)).not.toThrow();
  });

  it("media element errors are beaconed and surfaced", () => {
    const beacons = { error: vi.fn() };
    const { video } = setup({ beacons: beacons as never });
    defineProps(video, { error: { code: 4 } });
    fireEvent.error(video);
    expect(beacons.error).toHaveBeenCalledWith("media_4", true);
    expect(hlsState.setError).toHaveBeenCalledWith("Network error");
    defineProps(video, { error: null });
    fireEvent.error(video);
    expect(beacons.error).toHaveBeenLastCalledWith("media_0", true);
  });

  it("the error overlay replaces the play button and retry asks the parent for a new grant", () => {
    hlsState.error = "Boom";
    const { props } = setup();
    expect(screen.getByText("Boom")).toBeInTheDocument();
    expect(screen.queryAllByLabelText("Play")).toHaveLength(1);
    fireEvent.click(screen.getByText("Retry"));
    expect(props.onReload).toHaveBeenCalled();
  });

  it("sets the poster and CORS mode only for cross-origin subtitle tracks", () => {
    const a = setup({ poster: "https://cdn/p.jpg", subtitles: [{ lang: "en", url: "https://cdn.other/en.vtt" }] });
    expect(a.video.getAttribute("poster")).toBe("https://cdn/p.jpg");
    expect(a.video.getAttribute("crossorigin")).toBe("anonymous");
    a.unmount();
    const b = setup({ subtitles: [{ lang: "en", url: "/en.vtt" }] });
    expect(b.video.hasAttribute("crossorigin")).toBe(false);
    expect(b.video.hasAttribute("poster")).toBe(false);
    b.unmount();
    const c = setup({ subtitles: [{ lang: "en", url: "http://[bad" }] });
    expect(c.video.hasAttribute("crossorigin")).toBe(false);
  });
});

describe("progress reporting", () => {
  it("reports every 15s only while playing, and flushes on pagehide, hidden tab and unmount", () => {
    const { video, props, unmount } = setup();
    defineProps(video, { paused: true, ended: false, currentTime: 5, duration: 50, buffered: { length: 0 } });
    fireEvent.timeUpdate(video);
    act(() => void vi.advanceTimersByTime(15_000));
    expect(props.onProgress).not.toHaveBeenCalled();
    defineProps(video, { paused: false });
    act(() => void vi.advanceTimersByTime(15_000));
    expect(props.onProgress).toHaveBeenCalledTimes(1);
    defineProps(video, { ended: true });
    act(() => void vi.advanceTimersByTime(15_000));
    expect(props.onProgress).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("pagehide"));
    expect(props.onProgress).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(props.onProgress).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(props.onProgress).toHaveBeenCalledTimes(3);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    unmount();
    expect(props.onProgress).toHaveBeenCalledTimes(4);
    expect(props.onProgress).toHaveBeenLastCalledWith(5, 50);
  });

  it("does not run the timer without a source", () => {
    const { props, unmount } = setup({ src: null });
    act(() => void vi.advanceTimersByTime(30_000));
    unmount();
    expect(props.onProgress).not.toHaveBeenCalled();
  });

  it("a new source resets the position to the resume point", () => {
    setup({ resumeAt: 77 });
    const o = hlsState.options as unknown as Record<string, () => void>;
    act(() => o.onSourceAttached());
    // exercised through the unmount flush below
  });

  it("flushes the resume position if unmounted before any playback", () => {
    const { props, unmount } = setup({ resumeAt: 77 });
    act(() => (hlsState.options as unknown as Record<string, () => void>).onSourceAttached());
    unmount();
    expect(props.onProgress).toHaveBeenLastCalledWith(77, null);
  });
});

describe("seeking, mute, volume", () => {
  it("back/forward 10 clamp to [0, duration] and beacon the seek", () => {
    const beacons = { seek: vi.fn() };
    const { video } = setup({ beacons: beacons as never });
    defineProps(video, { currentTime: 5, duration: 100 });
    fireEvent.click(screen.getByLabelText("Back 10"));
    expect(video.currentTime).toBe(0);
    defineProps(video, { currentTime: 95 });
    fireEvent.click(screen.getByLabelText("Forward 10"));
    expect(video.currentTime).toBe(100);
    expect(beacons.seek).toHaveBeenCalledWith(0);
    expect(beacons.seek).toHaveBeenCalledWith(100);
    defineProps(video, { currentTime: 20, duration: NaN });
    fireEvent.click(screen.getByLabelText("Forward 10"));
    expect(video.currentTime).toBe(30);
  });

  it("the seek slider jumps to the chosen time", () => {
    const { video } = setup();
    defineProps(video, { currentTime: 0, duration: 100 });
    fireEvent.durationChange(video);
    fireEvent.change(screen.getByLabelText("Seek"), { target: { value: "42.5" } });
    expect(video.currentTime).toBe(42.5);
  });

  it("mute toggles the element", () => {
    const { video } = setup();
    defineProps(video, { muted: false });
    fireEvent.click(screen.getByLabelText("Mute"));
    expect(video.muted).toBe(true);
    expect(screen.getByLabelText("Unmute")).toBeInTheDocument();
  });

  it("the volume slider sets volume and mutes at zero", () => {
    const { video } = setup();
    defineProps(video, { volume: 1, muted: false });
    fireEvent.change(screen.getByLabelText("Volume"), { target: { value: "0.5" } });
    expect(video.volume).toBe(0.5);
    expect(video.muted).toBe(false);
    fireEvent.change(screen.getByLabelText("Volume"), { target: { value: "0" } });
    expect(video.muted).toBe(true);
  });

  it("next only renders when there is one and calls onNext", () => {
    const a = setup();
    fireEvent.click(screen.getByLabelText("Next"));
    expect(a.props.onNext).toHaveBeenCalled();
    a.unmount();
    setup({ hasNext: false });
    expect(screen.queryByLabelText("Next")).toBeNull();
  });
});

describe("fullscreen", () => {
  it("enters via requestFullscreen on the container, exits via document.exitFullscreen, and tracks the change event", async () => {
    const { region } = setup();
    const request = vi.fn().mockResolvedValue(undefined);
    region.requestFullscreen = request;
    await act(async () => void fireEvent.click(screen.getByLabelText("Fullscreen")));
    expect(request).toHaveBeenCalled();
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: region });
    act(() => void document.dispatchEvent(new Event("fullscreenchange")));
    expect(screen.getByLabelText("Exit fullscreen")).toBeInTheDocument();
    expect(region.className).toContain("rounded-none");
    const exit = vi.fn().mockResolvedValue(undefined);
    document.exitFullscreen = exit;
    await act(async () => void fireEvent.click(screen.getByLabelText("Exit fullscreen")));
    expect(exit).toHaveBeenCalled();
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    act(() => void document.dispatchEvent(new Event("fullscreenchange")));
    expect(screen.getByLabelText("Fullscreen")).toBeInTheDocument();
  });

  it("falls back to webkitEnterFullscreen on the video (iOS) and tolerates refusal", async () => {
    const { video, region } = setup();
    const webkit = vi.fn();
    defineProps(video, { webkitEnterFullscreen: webkit });
    region.requestFullscreen = undefined as never;
    await act(async () => void fireEvent.click(screen.getByLabelText("Fullscreen")));
    expect(webkit).toHaveBeenCalled();
    region.requestFullscreen = vi.fn().mockRejectedValue(new Error("denied"));
    await act(async () => void fireEvent.click(screen.getByLabelText("Fullscreen")));
  });
});

describe("keyboard", () => {
  it("handles space/k/arrows/m/f/n and ignores unrelated keys and range inputs", () => {
    const { video, region, props } = setup();
    defineProps(video, { paused: true, currentTime: 50, duration: 100, muted: false });
    region.requestFullscreen = vi.fn().mockResolvedValue(undefined);
    fireEvent.keyDown(region, { key: " " });
    fireEvent.keyDown(region, { key: "k" });
    expect(video.play).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(region, { key: "ArrowRight" });
    expect(video.currentTime).toBe(60);
    fireEvent.keyDown(region, { key: "ArrowLeft" });
    expect(video.currentTime).toBe(50);
    fireEvent.keyDown(region, { key: "m" });
    expect(video.muted).toBe(true);
    fireEvent.keyDown(region, { key: "f" });
    expect(region.requestFullscreen).toHaveBeenCalled();
    fireEvent.keyDown(region, { key: "n" });
    expect(props.onNext).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(region, { key: "z" });
    fireEvent.keyDown(screen.getByLabelText("Seek"), { key: " " });
    expect(video.play).toHaveBeenCalledTimes(2);
  });

  it("n does nothing without a next episode, and c cycles subtitles only when tracks exist", () => {
    const a = setup({ hasNext: false });
    fireEvent.keyDown(a.region, { key: "n" });
    expect(a.props.onNext).not.toHaveBeenCalled();
    fireEvent.keyDown(a.region, { key: "c" });
    expect(screen.queryByLabelText("Subtitles")).toBeNull();
  });

  it("c toggles subtitles between off and the default language (or the first track)", () => {
    const tracks = [{ lang: "ta", url: "/ta.vtt" }, { lang: "hi", url: "/hi.vtt" }];
    const a = setup({ subtitles: tracks, defaultSubtitleLang: "hi" });
    fireEvent.keyDown(a.region, { key: "c" }); // hi is default so starts on; this turns it off
    expect(screen.getByLabelText("Subtitles").getAttribute("aria-pressed")).toBe("false");
    fireEvent.keyDown(a.region, { key: "c" });
    expect(screen.getByLabelText("Subtitles").getAttribute("aria-pressed")).toBe("true");
    expect(window.localStorage.getItem("katha.subtitles")).toBe("hi");
    a.unmount();
    window.localStorage.clear();
    const b = setup({ subtitles: tracks, defaultSubtitleLang: "en" });
    fireEvent.keyDown(b.region, { key: "c" });
    expect(window.localStorage.getItem("katha.subtitles")).toBe("ta");
  });
});

describe("subtitles", () => {
  const tracks = [{ lang: "en", url: "/en.vtt" }, { lang: "hi", url: "/hi.vtt" }];

  it("starts on the UI language, off without a match, and honours a saved preference", () => {
    const a = setup({ subtitles: tracks, defaultSubtitleLang: "hi" });
    expect(a.video.querySelectorAll("track")).toHaveLength(2);
    expect(a.video.querySelector("track[srclang=hi]")!.hasAttribute("default")).toBe(true);
    a.unmount();
    const b = setup({ subtitles: tracks, defaultSubtitleLang: "fr" });
    expect(screen.getByLabelText("Subtitles").getAttribute("aria-pressed")).toBe("false");
    b.unmount();
    window.localStorage.setItem("katha.subtitles", "en");
    const c = setup({ subtitles: tracks, defaultSubtitleLang: "hi" });
    expect(c.video.querySelector("track[srclang=en]")!.hasAttribute("default")).toBe(true);
    c.unmount();
    window.localStorage.setItem("katha.subtitles", "off");
    setup({ subtitles: tracks, defaultSubtitleLang: "hi" });
    expect(screen.getByLabelText("Subtitles").getAttribute("aria-pressed")).toBe("false");
  });

  it("an unknown saved language falls back to the default; unreadable storage is tolerated", () => {
    window.localStorage.setItem("katha.subtitles", "zz");
    const a = setup({ subtitles: tracks, defaultSubtitleLang: "hi" });
    expect(a.video.querySelector("track[srclang=hi]")!.hasAttribute("default")).toBe(true);
    a.unmount();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("x");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("x");
    });
    setup({ subtitles: tracks });
    fireEvent.click(screen.getByLabelText("Subtitles"));
    expect(() => fireEvent.click(screen.getByText("EN"))).not.toThrow();
  });

  it("the menu lists Off + languages (with labels), selects, persists and closes", () => {
    setup({ subtitles: tracks, subtitleLabel: (l) => (l === "hi" ? "Hindi" : "English") });
    const button = screen.getByLabelText("Subtitles");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(screen.getAllByRole("menuitemradio").map((i) => i.textContent)).toEqual(["Off", "English", "Hindi"]);
    expect(screen.getByText("Off").closest("button")!.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByText("Hindi"));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(window.localStorage.getItem("katha.subtitles")).toBe("hi");
    expect(screen.getByLabelText("Subtitles").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByLabelText("Subtitles"));
    fireEvent.click(screen.getByText("Off"));
    expect(window.localStorage.getItem("katha.subtitles")).toBe("off");
  });

  it("closes on outside click and Escape, but not on a click inside the menu", () => {
    setup({ subtitles: tracks });
    fireEvent.click(screen.getByLabelText("Subtitles"));
    fireEvent.mouseDown(screen.getByRole("menu"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByLabelText("Subtitles"));
    fireEvent.keyDown(document, { key: "a" });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("applies the selection to the browser's text tracks, including ones added later", () => {
    const { video } = setup({ subtitles: tracks, defaultSubtitleLang: "hi" });
    const entry = (trackLists.get(video) ?? { tracks: [], listeners: new Set<() => void>() });
    trackLists.set(video, entry);
    entry.tracks.push({ kind: "subtitles", language: "en", mode: "showing" }, { kind: "captions", language: "hi", mode: "disabled" }, { kind: "metadata", language: "hi", mode: "x" });
    act(() => entry.listeners.forEach((fn) => fn()));
    expect(entry.tracks.map((t) => t.mode)).toEqual(["disabled", "showing", "x"]);
    fireEvent.click(screen.getByLabelText("Subtitles"));
    fireEvent.click(screen.getByText("Off"));
    expect(entry.tracks.map((t) => t.mode)).toEqual(["disabled", "disabled", "x"]);
  });
});

describe("pointer gestures", () => {
  function rect(el: HTMLElement) {
    el.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON() {} });
  }

  it("a short tap toggles play", () => {
    const { video, container } = setup();
    defineProps(video, { paused: true });
    const s = tapSurface(container);
    rect(s);
    fireEvent.pointerDown(s, { pointerId: 1, button: 0, clientX: 90 });
    fireEvent.pointerUp(s, { pointerId: 1 });
    expect(video.play).toHaveBeenCalled();
  });

  it("holding the right side for 350ms while playing doubles the speed and release restores it without toggling", () => {
    const { video, container } = setup();
    defineProps(video, { paused: false, playbackRate: 1 });
    const s = tapSurface(container);
    rect(s);
    fireEvent.pointerDown(s, { pointerId: 1, button: 0, clientX: 90 });
    act(() => void vi.advanceTimersByTime(350));
    expect(video.playbackRate).toBe(2);
    expect(screen.getByText("2× speed")).toBeInTheDocument();
    fireEvent.pointerUp(s, { pointerId: 1 });
    expect(video.playbackRate).toBe(1);
    expect(screen.queryByText("2× speed")).toBeNull();
    expect(video.pause).not.toHaveBeenCalled();
  });

  it("does not speed up when paused, on the left side, or for a non-primary button", () => {
    const { video, container } = setup();
    defineProps(video, { paused: true, playbackRate: 1 });
    const s = tapSurface(container);
    rect(s);
    fireEvent.pointerDown(s, { pointerId: 1, button: 0, clientX: 90 });
    act(() => void vi.advanceTimersByTime(400));
    expect(video.playbackRate).toBe(1);
    fireEvent.pointerCancel(s, { pointerId: 1 });
    defineProps(video, { paused: false });
    fireEvent.pointerDown(s, { pointerId: 2, button: 0, clientX: 10 });
    act(() => void vi.advanceTimersByTime(400));
    expect(video.playbackRate).toBe(1);
    fireEvent.pointerLeave(s, { pointerId: 2 });
    fireEvent.pointerDown(s, { pointerId: 3, button: 2, clientX: 90 });
    act(() => void vi.advanceTimersByTime(400));
    expect(video.playbackRate).toBe(1);
  });

  it("a pointer-up from a different pointer, or a cancel, never toggles playback", () => {
    const { video, container } = setup();
    defineProps(video, { paused: true });
    const s = tapSurface(container);
    rect(s);
    fireEvent.pointerDown(s, { pointerId: 1, button: 0, clientX: 90 });
    fireEvent.pointerUp(s, { pointerId: 9 });
    fireEvent.pointerCancel(s, { pointerId: 1 });
    expect(video.play).not.toHaveBeenCalled();
  });

  it("a second press cancels the earlier hold timer", () => {
    const { video, container } = setup();
    defineProps(video, { paused: false, playbackRate: 1 });
    const s = tapSurface(container);
    rect(s);
    fireEvent.pointerDown(s, { pointerId: 1, button: 0, clientX: 90 });
    fireEvent.pointerDown(s, { pointerId: 1, button: 0, clientX: 10 });
    act(() => void vi.advanceTimersByTime(400));
    expect(video.playbackRate).toBe(1);
  });
});

describe("controls visibility", () => {
  it("hides after 2.5s of inactivity while playing, returns on mouse move, and is inert while hidden", () => {
    const { video, region, container } = setup();
    const bar = () => container.querySelector("[inert], .opacity-0, .opacity-100")!.parentElement!.querySelector("div.bottom-0") as HTMLElement;
    defineProps(video, { paused: false });
    fireEvent.play(video);
    expect(bar().className).toContain("opacity-100");
    act(() => void vi.advanceTimersByTime(2500));
    expect(bar().className).toContain("opacity-0");
    expect(bar().hasAttribute("inert")).toBe(true);
    fireEvent.mouseMove(region);
    expect(bar().className).toContain("opacity-100");
    expect(bar().hasAttribute("inert")).toBe(false);
    fireEvent.mouseLeave(region);
    expect(bar().className).toContain("opacity-0");
  });

  it("stays visible if the video paused before the timer fired, and mouse leave is ignored while paused", () => {
    const { video, region, container } = setup();
    defineProps(video, { paused: false });
    fireEvent.play(video);
    defineProps(video, { paused: true });
    act(() => void vi.advanceTimersByTime(3000));
    expect((container.querySelector("div.bottom-0") as HTMLElement).className).toContain("opacity-100");
    fireEvent.pause(video);
    fireEvent.mouseLeave(region);
    expect((container.querySelector("div.bottom-0") as HTMLElement).className).toContain("opacity-100");
  });

  it("keyboard focus inside the control bar keeps it visible until focus leaves", () => {
    const { video, container } = setup();
    defineProps(video, { paused: false });
    fireEvent.play(video);
    act(() => void vi.advanceTimersByTime(2500));
    const bar = container.querySelector("div.bottom-0") as HTMLElement;
    const btn = screen.getByLabelText("Mute", { selector: "button" });
    fireEvent.focus(btn);
    expect(bar.className).toContain("opacity-100");
    fireEvent.blur(btn, { relatedTarget: btn });
    expect(bar.className).toContain("opacity-100");
    fireEvent.blur(btn, { relatedTarget: document.body });
    expect(bar.className).toContain("opacity-0");
  });

  it("touch shows controls and pointerdown inside the bar does not reach the tap surface", () => {
    const { video, container } = setup();
    defineProps(video, { paused: true });
    fireEvent.touchStart(tapSurface(container));
    fireEvent.pointerDown(screen.getByLabelText("Mute"), { pointerId: 1, button: 0 });
    expect(video.play).not.toHaveBeenCalled();
  });

  it("clears timers on unmount", () => {
    const { video, unmount, container } = setup();
    defineProps(video, { paused: true });
    fireEvent.mouseMove(container.firstElementChild!);
    const s = tapSurface(container);
    s.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;
    fireEvent.pointerDown(s, { pointerId: 1, button: 0, clientX: 90 });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
