import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeHls } from "./hls-mock";

vi.mock("hls.js", () => ({ default: FakeHls }));

import { useHls, type UseHlsOptions } from "./use-hls";

const labels = { unsupported: "No HLS", networkError: "Net down", mediaError: "Bad media" };
let video: HTMLVideoElement;

function setup(over: Partial<UseHlsOptions> = {}) {
  const props: UseHlsOptions = { src: "https://cdn/x.m3u8", autoPlay: true, labels, ...over };
  const ref = { current: video };
  return renderHook((p: UseHlsOptions) => useHls(ref, p), { initialProps: props });
}
const hls = () => FakeHls.instances[FakeHls.instances.length - 1];
const ready = () => waitFor(() => expect(FakeHls.instances.length).toBeGreaterThan(0));

beforeEach(() => {
  FakeHls.reset();
  video = document.createElement("video");
  video.play = vi.fn().mockResolvedValue(undefined);
  video.load = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

describe("useHls with hls.js", () => {
  it("does nothing without a src", () => {
    const onSourceAttached = vi.fn();
    const { result } = setup({ src: null, onSourceAttached });
    expect(FakeHls.instances).toHaveLength(0);
    expect(onSourceAttached).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it("does nothing without a video element", () => {
    renderHook(() => useHls({ current: null }, { src: "x", autoPlay: true, labels }));
    expect(FakeHls.instances).toHaveLength(0);
  });

  it("loads the source, starts from the resume position and autoplays when the manifest parses", async () => {
    const onSourceAttached = vi.fn();
    setup({ startAt: 42, onSourceAttached });
    await ready();
    expect(onSourceAttached).toHaveBeenCalled();
    expect(hls().config).toMatchObject({ startPosition: 42, autoStartLoad: true });
    expect(hls().loadSource).toHaveBeenCalledWith("https://cdn/x.m3u8");
    expect(hls().attachMedia).toHaveBeenCalledWith(video);
    act(() => hls().emit("manifestParsed"));
    expect(video.play).toHaveBeenCalled();
  });

  it("ignores resume positions <= 1s and does not autoplay when disabled", async () => {
    setup({ startAt: 1, autoPlay: false });
    await ready();
    expect(hls().config.startPosition).toBe(-1);
    act(() => hls().emit("manifestParsed"));
    expect(video.play).not.toHaveBeenCalled();
  });

  it("swallows a rejected autoplay", async () => {
    video.play = vi.fn().mockRejectedValue(new Error("blocked"));
    setup();
    await ready();
    expect(() => act(() => hls().emit("manifestParsed"))).not.toThrow();
  });

  it("reports rendition switches in kbps, with undefined height when unknown", async () => {
    const onLevelSwitch = vi.fn();
    setup({ onLevelSwitch });
    await ready();
    act(() => hls().emit("levelSwitched", { level: 0 }));
    expect(onLevelSwitch).toHaveBeenLastCalledWith(800, 480);
    act(() => hls().emit("levelSwitched", { level: 1 }));
    expect(onLevelSwitch).toHaveBeenLastCalledWith(2500, undefined);
    act(() => hls().emit("levelSwitched", { level: 9 }));
    expect(onLevelSwitch).toHaveBeenCalledTimes(2);
  });

  it("sets the unsupported error when hls.js cannot run", async () => {
    FakeHls.supported = false;
    const { result } = setup();
    await waitFor(() => expect(result.current.error).toBe("No HLS"));
    expect(FakeHls.instances).toHaveLength(0);
  });

  it("ignores non-fatal errors", async () => {
    const onFatalError = vi.fn();
    setup({ onFatalError });
    await ready();
    act(() => hls().emit("error", { fatal: false, details: "x", type: "networkError" }));
    expect(onFatalError).not.toHaveBeenCalled();
    expect(hls().destroy).not.toHaveBeenCalled();
  });

  it("recovers fatal media errors 3 times, then swaps codec, then gives up with the media error", async () => {
    const onFatalError = vi.fn();
    const { result } = setup({ onFatalError });
    await ready();
    const fatal = () => act(() => hls().emit("error", { fatal: true, details: "bufferAppendError", type: "mediaError" }));
    fatal();
    fatal();
    fatal();
    expect(hls().recoverMediaError).toHaveBeenCalledTimes(3);
    expect(hls().swapAudioCodec).not.toHaveBeenCalled();
    fatal();
    expect(hls().swapAudioCodec).toHaveBeenCalledTimes(1);
    expect(hls().recoverMediaError).toHaveBeenCalledTimes(4);
    expect(result.current.error).toBeNull();
    fatal();
    expect(hls().destroy).toHaveBeenCalled();
    expect(result.current.error).toBe("Bad media");
    expect(result.current.hlsRef.current).toBeNull();
    expect(onFatalError).toHaveBeenCalledWith("bufferAppendError");
    expect(onFatalError).toHaveBeenCalledTimes(5);
  });

  it("shows the network error for a fatal network error with a valid grant", async () => {
    const onReload = vi.fn();
    const { result } = setup({ onReload, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await ready();
    act(() => hls().emit("error", { fatal: true, details: "manifestLoadError", type: "networkError" }));
    expect(hls().destroy).toHaveBeenCalled();
    expect(result.current.error).toBe("Net down");
    expect(onReload).not.toHaveBeenCalled();
  });

  it("asks for a fresh grant once when the URL expired, then shows the error", async () => {
    const onReload = vi.fn();
    const past = new Date(Date.now() - 1000).toISOString();
    const { result } = setup({ onReload, expiresAt: past });
    await ready();
    act(() => hls().emit("error", { fatal: true, details: "d", type: "networkError" }));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
    act(() => hls().emit("error", { fatal: true, details: "d", type: "networkError" }));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe("Net down");
  });

  it("shows the error when expired but there is no reload handler", async () => {
    const { result } = setup({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    await ready();
    act(() => hls().emit("error", { fatal: true, details: "d", type: "networkError" }));
    expect(result.current.error).toBe("Net down");
  });

  it("destroys the instance on unmount and when src changes (with a fresh recovery budget)", async () => {
    const { rerender, unmount, result } = setup();
    await ready();
    const first = hls();
    act(() => first.emit("error", { fatal: true, details: "d", type: "mediaError" }));
    rerender({ src: "https://cdn/y.m3u8", autoPlay: true, labels });
    expect(first.destroy).toHaveBeenCalled();
    await waitFor(() => expect(FakeHls.instances).toHaveLength(2));
    const second = hls();
    for (let i = 0; i < 3; i++) act(() => second.emit("error", { fatal: true, details: "d", type: "mediaError" }));
    expect(second.recoverMediaError).toHaveBeenCalledTimes(3);
    expect(result.current.error).toBeNull();
    unmount();
    expect(second.destroy).toHaveBeenCalled();
  });

  it("does not build an instance when unmounted before hls.js finishes loading", async () => {
    const { unmount } = setup();
    unmount();
    await new Promise((r) => setTimeout(r, 0));
    expect(FakeHls.instances).toHaveLength(0);
  });

  it("reads the latest callbacks without reloading the stream", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = setup({ onFatalError: first });
    await ready();
    rerender({ src: "https://cdn/x.m3u8", autoPlay: true, labels, onFatalError: second });
    act(() => hls().emit("error", { fatal: true, details: "z", type: "networkError" }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("z");
    expect(FakeHls.instances).toHaveLength(1);
  });
});

describe("useHls with native HLS (Safari)", () => {
  const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605 Version/17 Safari/605.1.15";

  it("uses video.src, seeks and plays on loadedmetadata, and cleans up", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(SAFARI);
    video.canPlayType = vi.fn().mockReturnValue("maybe");
    const { unmount } = setup({ startAt: 30 });
    expect(video.getAttribute("src")).toBe("https://cdn/x.m3u8");
    expect(FakeHls.instances).toHaveLength(0);
    video.dispatchEvent(new Event("loadedmetadata"));
    expect(video.currentTime).toBe(30);
    expect(video.play).toHaveBeenCalled();
    unmount();
    expect(video.hasAttribute("src")).toBe(false);
    expect(video.load).toHaveBeenCalled();
  });

  it("does not seek for tiny resume positions or autoplay when off", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(SAFARI);
    video.canPlayType = vi.fn().mockReturnValue("probably");
    setup({ startAt: 0, autoPlay: false });
    video.dispatchEvent(new Event("loadedmetadata"));
    expect(video.currentTime).toBe(0);
    expect(video.play).not.toHaveBeenCalled();
  });

  it("falls back to native when MSE is missing even outside Safari", () => {
    const original = (globalThis as { MediaSource?: unknown }).MediaSource;
    delete (globalThis as { MediaSource?: unknown }).MediaSource;
    video.canPlayType = vi.fn().mockReturnValue("maybe");
    setup();
    expect(video.getAttribute("src")).toBe("https://cdn/x.m3u8");
    if (original) (globalThis as { MediaSource?: unknown }).MediaSource = original;
  });

  it("Chrome that claims native support still goes through hls.js", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 Chrome/120 Safari/537.36");
    (globalThis as { MediaSource?: unknown }).MediaSource = class {};
    video.canPlayType = vi.fn().mockReturnValue("maybe");
    setup();
    await ready();
    expect(video.hasAttribute("src")).toBe(false);
    delete (globalThis as { MediaSource?: unknown }).MediaSource;
  });
});
