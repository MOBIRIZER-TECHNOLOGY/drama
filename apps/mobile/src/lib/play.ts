import { api } from "@/lib/api";
import { RequestError, unwrap } from "@/lib/errors";
import type { PlayOut } from "@/lib/types";

export type Grant = PlayOut & { fetchedAt: number };

/** Playback URLs are CDN-signed for ~5 minutes. Treat a grant as stale a little before it expires. */
const STALE_MARGIN_MS = 20_000;

export function grantIsFresh(grant: Grant | undefined): grant is Grant {
  if (!grant) return false;
  const expires = Date.parse(grant.expires_at);
  if (Number.isNaN(expires)) return Date.now() - grant.fetchedAt < 4 * 60_000;
  return Date.now() < expires - STALE_MARGIN_MS;
}

export type PlayResult =
  | { ok: true; grant: Grant }
  | { ok: false; code: "locked" | "unauthorized" | "not_ready" | "age_gate" | "error"; message: string };

export const NOT_READY_MESSAGE = "This episode is still being prepared. Try again shortly.";
export const SIGN_IN_TO_WATCH = "Sign in to keep watching.";

/** POST /v1/episodes/{id}/play — the only place a media URL may come from. */
export async function requestPlay(episodeId: string): Promise<PlayResult> {
  try {
    const out = unwrap(await api.POST("/v1/episodes/{episode_id}/play", { params: { path: { episode_id: episodeId } } }));
    return { ok: true, grant: { ...out, fetchedAt: Date.now() } };
  } catch (e) {
    if (e instanceof RequestError) {
      // Adult content: the viewer must confirm they are 18+ before the grant is issued.
      if (e.code === "age_gate_required") return { ok: false, code: "age_gate", message: e.message };
      if (e.status === 403) return { ok: false, code: "locked", message: e.message };
      if (e.status === 401) return { ok: false, code: "unauthorized", message: SIGN_IN_TO_WATCH };
      if (e.status === 409 && e.code === "asset_not_ready") return { ok: false, code: "not_ready", message: NOT_READY_MESSAGE };
      return { ok: false, code: "error", message: e.message };
    }
    return { ok: false, code: "error", message: "Could not start playback" };
  }
}

/** Fire-and-forget progress write; failures are swallowed because progress is best effort. */
export function putProgress(episodeId: string, positionSec: number, completed = false): void {
  api
    .PUT("/v1/episodes/{episode_id}/progress", {
      params: { path: { episode_id: episodeId } },
      body: { position_sec: Math.max(0, Math.floor(positionSec)), completed },
    })
    .catch(() => {});
}
