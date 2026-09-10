import { api, ApiError, call, type Schemas } from "./api";
import { startPolling } from "./polling";

export type MetadataDraft = Schemas["MetadataOut"];
export type JobOut = Schemas["JobOut"];
/** A queued AI/media job as `GET /v1/admin/ai/jobs/{job_id}` reports it: queued, running, complete, failed or not_found. */
export type AiJob = Schemas["JobStatusOut"];

/** Readable messages for the AI router's failure modes. */
export function aiErrorMessage(e: unknown, fallback = "AI request failed"): string {
  if (e instanceof ApiError) {
    if (e.code === "ai_unavailable" || e.status === 503) {
      return "AI is unavailable right now (no provider configured or the service is down). Try again later.";
    }
    if (e.code === "ai_error" || e.status === 502) {
      return `The AI provider returned an error: ${e.message}`;
    }
    return e.message;
  }
  return e instanceof Error ? e.message : fallback;
}

export function generateSeriesMetadata(body: Schemas["MetadataIn"]): Promise<MetadataDraft> {
  return call(api.POST("/v1/admin/ai/series-metadata", { body }));
}

export function translateSeries(seriesId: string, languages: string[] | null = null): Promise<JobOut> {
  return call(api.POST("/v1/admin/ai/series/{series_id}/translate", { params: { path: { series_id: seriesId } }, body: { languages } }));
}

export function refreshSeriesEmbeddings(seriesId: string): Promise<JobOut> {
  return call(api.POST("/v1/admin/ai/series/{series_id}/embeddings", { params: { path: { series_id: seriesId } } }));
}

/** Transcript of the first N episodes, used to prefill the metadata seed. */
export function getSeriesTranscript(seriesId: string, episodes = 3): Promise<Schemas["TranscriptOut"]> {
  return call(api.GET("/v1/admin/ai/series/{series_id}/transcript", { params: { path: { series_id: seriesId }, query: { episodes } } }));
}

/** Queue a pgvector refresh for the whole catalogue (owner-scale operation). */
export function reembedAll(): Promise<JobOut> {
  return call(api.POST("/v1/admin/ai/reembed-all"));
}

export function generateEpisodeSubtitles(episodeId: string, languages: string[] | null = null): Promise<JobOut> {
  return call(api.POST("/v1/admin/ai/episodes/{episode_id}/subtitles", { params: { path: { episode_id: episodeId } }, body: { languages } }));
}

export function getAiJob(jobId: string): Promise<AiJob> {
  return call(api.GET("/v1/admin/ai/jobs/{job_id}", { params: { path: { job_id: jobId } } }));
}

export const AI_JOB_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * Poll a job every 3 s (backing off on errors, paused while hidden) for up to 3 minutes.
 * `onDone` receives the terminal job or, on timeout, a synthetic `running` job.
 */
export function pollAiJob(jobId: string, onDone: (job: AiJob, timedOut: boolean) => void): () => void {
  return startPolling({
    tick: async () => {
      const job = await getAiJob(jobId);
      if (job.status === "complete" || job.status === "failed" || job.status === "not_found") {
        onDone(job, false);
        return true;
      }
      return false;
    },
    timeoutMs: AI_JOB_TIMEOUT_MS,
    onTimeout: () => onDone({ job_id: jobId, status: "running" }, true),
  });
}

export function jobQueuedText(what: string, job: JobOut): string {
  return job.queued ? `${what} queued${job.job_id ? ` (job ${job.job_id})` : ""}` : `${what}: nothing to do`;
}

export function jobOutcomeText(what: string, job: AiJob, timedOut: boolean): { ok: boolean; text: string } {
  if (timedOut) return { ok: false, text: `${what} is still running after 3 minutes; check back later (job ${job.job_id}).` };
  if (job.status === "complete") return { ok: true, text: `${what} finished.` };
  if (job.status === "not_found") return { ok: false, text: `${what}: job ${job.job_id} was not found.` };
  return { ok: false, text: `${what} failed${job.error ? `: ${job.error}` : ""}.` };
}
