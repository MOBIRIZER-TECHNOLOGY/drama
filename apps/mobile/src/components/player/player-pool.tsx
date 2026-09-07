import { createVideoPlayer, type VideoPlayer } from "expo-video";
import { createContext, useContext, useEffect, useMemo, useRef, type PropsWithChildren } from "react";

export const MAX_PLAYERS = 3;

export type PlayerPool = {
  /** Player for `id`, creating it if needed. Never evicts the pinned (current) player. */
  acquire(id: string): VideoPlayer;
  get(id: string): VideoPlayer | null;
  /** Declare the prev/current/next window. Everything outside it is paused and released (deferred). */
  syncWindow(ids: readonly string[], currentId: string | null): void;
  /** True while `id` is part of the last declared window; async loaders check this after every await. */
  inWindow(id: string): boolean;
  /** Release every player (a screen losing focus, e.g. Shorts when the full player opens). */
  releaseAll(): void;
};

const PlayerPoolContext = createContext<PlayerPool | null>(null);

function safeRelease(player: VideoPlayer) {
  // Deferred so a VideoView that is unmounting in the same commit detaches before the native object dies.
  queueMicrotask(() => {
    try {
      player.pause();
    } catch {
      // already released
    }
    try {
      player.release();
    } catch {
      // already released
    }
  });
}

/**
 * One pool for the whole app: the Shorts tab and the full-screen player share it, so at most three
 * `VideoPlayer` instances exist no matter how screens overlap.
 */
export function PlayerPoolProvider({ children }: PropsWithChildren) {
  const players = useRef(new Map<string, VideoPlayer>());
  const windowRef = useRef<Set<string>>(new Set());
  const pinned = useRef<string | null>(null);

  const pool = useMemo<PlayerPool>(() => {
    const release = (id: string) => {
      const p = players.current.get(id);
      if (!p) return;
      players.current.delete(id);
      safeRelease(p);
    };
    return {
      acquire(id) {
        const existing = players.current.get(id);
        if (existing) return existing;
        if (players.current.size >= MAX_PLAYERS) {
          // Evict the oldest player that is neither pinned nor in the window; then any non-pinned one.
          const candidates = Array.from(players.current.keys()).filter((k) => k !== pinned.current);
          const victim = candidates.find((k) => !windowRef.current.has(k)) ?? candidates[0];
          if (victim !== undefined) release(victim);
        }
        const player = createVideoPlayer(null);
        player.loop = false;
        player.timeUpdateEventInterval = 0;
        player.preservesPitch = true;
        player.audioMixingMode = "auto";
        players.current.set(id, player);
        return player;
      },
      get: (id) => players.current.get(id) ?? null,
      syncWindow(ids, currentId) {
        windowRef.current = new Set(ids);
        pinned.current = currentId;
        for (const id of Array.from(players.current.keys())) {
          if (!windowRef.current.has(id) && id !== currentId) release(id);
        }
      },
      inWindow: (id) => windowRef.current.has(id),
      releaseAll() {
        windowRef.current = new Set();
        pinned.current = null;
        for (const id of Array.from(players.current.keys())) release(id);
      },
    };
  }, []);

  useEffect(() => () => pool.releaseAll(), [pool]);

  return <PlayerPoolContext.Provider value={pool}>{children}</PlayerPoolContext.Provider>;
}

export function usePlayerPool(): PlayerPool {
  const ctx = useContext(PlayerPoolContext);
  if (!ctx) throw new Error("usePlayerPool must be used inside PlayerPoolProvider");
  return ctx;
}

/** Native mutation kept outside React so the compiler lint does not see a prop being written. */
export function setTimeUpdateInterval(player: VideoPlayer, seconds: number): void {
  try {
    if (player.timeUpdateEventInterval !== seconds) player.timeUpdateEventInterval = seconds;
  } catch {
    // released
  }
}

export function safePlayerCall(player: VideoPlayer, fn: (p: VideoPlayer) => void): void {
  try {
    fn(player);
  } catch {
    // The native object was released underneath us; nothing to do.
  }
}
