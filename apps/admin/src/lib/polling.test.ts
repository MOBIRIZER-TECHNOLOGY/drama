import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPolling } from "./polling";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

describe("startPolling", () => {
  it("ticks immediately then every interval until tick returns true", async () => {
    const tick = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    startPolling({ tick, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(tick).toHaveBeenCalledTimes(3);
  });
  it("backs off on errors up to the max and resets after success", async () => {
    const onError = vi.fn();
    const tick = vi
      .fn()
      .mockRejectedValueOnce(new Error("a"))
      .mockRejectedValueOnce("not an error")
      .mockRejectedValueOnce(new Error("c"))
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    startPolling({ tick, onError, intervalMs: 1000, maxIntervalMs: 3000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenLastCalledWith("a");
    await vi.advanceTimersByTimeAsync(1999);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); // delay 2000
    expect(onError).toHaveBeenLastCalledWith("Polling failed");
    await vi.advanceTimersByTimeAsync(3000); // capped at 3000
    expect(onError).toHaveBeenLastCalledWith("c");
    await vi.advanceTimersByTimeAsync(3000);
    expect(tick).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1000); // reset to base after success
    expect(tick).toHaveBeenCalledTimes(5);
  });
  it("works without an onError handler", async () => {
    const tick = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue(true);
    startPolling({ tick, intervalMs: 10 });
    await vi.advanceTimersByTimeAsync(100);
    expect(tick).toHaveBeenCalledTimes(2);
  });
  it("stops with onTimeout once timeoutMs has elapsed", async () => {
    const onTimeout = vi.fn();
    const tick = vi.fn().mockResolvedValue(false);
    startPolling({ tick, onTimeout, intervalMs: 1000, timeoutMs: 2500 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(tick.mock.calls.length).toBeLessThanOrEqual(4);
    const n = tick.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(tick).toHaveBeenCalledTimes(n);
  });
  it("cancel stops future ticks and ignores an in-flight result", async () => {
    let resolve!: (v: boolean) => void;
    const tick = vi.fn(() => new Promise<boolean>((r) => (resolve = r)));
    const stop = startPolling({ tick, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    resolve(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick).toHaveBeenCalledTimes(1);

    const tick2 = vi.fn().mockResolvedValue(false);
    const stop2 = startPolling({ tick: tick2, intervalMs: 100 });
    await vi.advanceTimersByTimeAsync(0);
    stop2();
    await vi.advanceTimersByTimeAsync(1000);
    expect(tick2).toHaveBeenCalledTimes(1);
  });
  it("cancel during an in-flight failing tick does not report or reschedule", async () => {
    let reject!: (e: Error) => void;
    const onError = vi.fn();
    const stop = startPolling({ tick: () => new Promise<boolean>((_, r) => (reject = r)), onError });
    await vi.advanceTimersByTimeAsync(0);
    stop();
    reject(new Error("late"));
    await vi.advanceTimersByTimeAsync(100_000);
    expect(onError).not.toHaveBeenCalled();
  });
  it("waits for the tab to become visible before polling", async () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    const tick = vi.fn().mockResolvedValue(true);
    startPolling({ tick });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(tick).not.toHaveBeenCalled();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);
  });
  it("does not resume after being stopped while hidden", async () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    const tick = vi.fn().mockResolvedValue(true);
    const stop = startPolling({ tick });
    stop();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).not.toHaveBeenCalled();
  });
});
