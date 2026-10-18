import { vi } from "vitest";

/** A scriptable stand-in for hls.js: tests grab the latest instance and fire its events. */
type Handler = (evt: string, data: unknown) => void;

export class FakeHls {
  static supported = true;
  static instances: FakeHls[] = [];
  static isSupported() {
    return FakeHls.supported;
  }
  static Events = { MANIFEST_PARSED: "manifestParsed", LEVEL_SWITCHED: "levelSwitched", ERROR: "error" };
  static ErrorTypes = { MEDIA_ERROR: "mediaError", NETWORK_ERROR: "networkError" };
  static reset() {
    FakeHls.supported = true;
    FakeHls.instances = [];
  }

  handlers: Record<string, Handler[]> = {};
  levels: { bitrate: number; height: number }[] = [
    { bitrate: 800_000, height: 480 },
    { bitrate: 2_500_000, height: 0 },
  ];
  loadSource = vi.fn();
  attachMedia = vi.fn();
  destroy = vi.fn();
  recoverMediaError = vi.fn();
  swapAudioCodec = vi.fn();
  constructor(public config: Record<string, unknown>) {
    FakeHls.instances.push(this);
  }
  on(evt: string, fn: Handler) {
    (this.handlers[evt] ||= []).push(fn);
  }
  emit(evt: string, data: unknown = {}) {
    for (const fn of this.handlers[evt] ?? []) fn(evt, data);
  }
}
