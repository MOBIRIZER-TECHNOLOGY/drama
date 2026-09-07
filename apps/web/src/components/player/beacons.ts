import { track } from "@/lib/analytics";

export type PlaybackTarget = { episodeId: string; seriesId: string; surface?: "series" | "shorts" };

/**
 * QoE beacons for one playback attempt. Create one per source load; call the methods from the media events.
 * Timings use `performance.now()` so tab clock changes never skew ttff.
 */
export class PlaybackBeacons {
  private startedAt: number | null = null;
  private firstFrameSent = false;
  private waitingSince: number | null = null;
  private completed = false;

  constructor(private readonly target: PlaybackTarget) {}

  private props(extra?: Record<string, string | number | boolean | null | undefined>) {
    return { episode_id: this.target.episodeId, series_id: this.target.seriesId, surface: this.target.surface ?? "series", ...extra };
  }

  /** Source attached; the clock for `first_frame` starts now. */
  start(): void {
    this.startedAt = performance.now();
    this.firstFrameSent = false;
    this.waitingSince = null;
    this.completed = false;
    track("play_start", this.props());
  }

  /** `playing` fired: first frame the first time, otherwise the end of a rebuffer. */
  playing(): void {
    const now = performance.now();
    if (!this.firstFrameSent) {
      this.firstFrameSent = true;
      if (this.startedAt != null) track("first_frame", this.props({ ttff_ms: Math.round(now - this.startedAt) }));
      this.waitingSince = null;
      return;
    }
    if (this.waitingSince != null) {
      track("rebuffer", this.props({ duration_ms: Math.round(now - this.waitingSince) }));
      this.waitingSince = null;
    }
  }

  /** `waiting` fired while playing: a stall until the next `playing`. */
  waiting(): void {
    if (this.firstFrameSent && this.waitingSince == null) this.waitingSince = performance.now();
  }

  /** Seeks look like stalls; cancel the pending rebuffer measurement. */
  seek(toSec: number): void {
    this.waitingSince = null;
    track("seek", this.props({ to_sec: Math.round(toSec) }));
  }

  levelSwitch(kbps: number, height?: number): void {
    track("bitrate_switch", this.props({ kbps: Math.round(kbps), height: height ?? null }));
  }

  error(code: string, fatal: boolean): void {
    track("play_error", this.props({ code, fatal }));
  }

  complete(): void {
    if (this.completed) return;
    this.completed = true;
    track("play_complete", this.props());
  }
}
