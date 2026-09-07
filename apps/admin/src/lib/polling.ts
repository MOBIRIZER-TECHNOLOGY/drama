/**
 * Shared poller: pauses while the tab is hidden, backs off exponentially on errors
 * (interval doubles up to `maxIntervalMs`, resets on success) and stops after `timeoutMs`.
 */
export type PollOptions = {
  /** Return true to stop polling (terminal state reached). May throw; errors back off. */
  tick: () => Promise<boolean>;
  onError?: (message: string) => void;
  onTimeout?: () => void;
  intervalMs?: number;
  maxIntervalMs?: number;
  timeoutMs?: number;
};

export function startPolling({
  tick,
  onError,
  onTimeout,
  intervalMs = 3000,
  maxIntervalMs = 30000,
  timeoutMs,
}: PollOptions): () => void {
  let stopped = false;
  let delay = intervalMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const startedAt = Date.now();
  const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

  const schedule = () => {
    if (stopped) return;
    if (timeoutMs != null && Date.now() - startedAt > timeoutMs) {
      stopped = true;
      onTimeout?.();
      return;
    }
    timer = setTimeout(run, delay);
  };

  const run = async () => {
    if (stopped) return;
    if (!visible()) {
      // Wait for the tab to come back rather than burning requests in the background.
      const resume = () => {
        document.removeEventListener("visibilitychange", resume);
        if (!stopped) void run();
      };
      document.addEventListener("visibilitychange", resume);
      return;
    }
    try {
      const done = await tick();
      if (stopped) return;
      delay = intervalMs;
      if (done) {
        stopped = true;
        return;
      }
    } catch (e) {
      if (stopped) return;
      onError?.(e instanceof Error ? e.message : "Polling failed");
      delay = Math.min(delay * 2, maxIntervalMs);
    }
    schedule();
  };

  void run();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
