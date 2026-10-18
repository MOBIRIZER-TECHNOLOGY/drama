import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fail, mockApi } from "@/test/api";
import { ApiError } from "./api";
import {
  AI_JOB_TIMEOUT_MS,
  aiErrorMessage,
  generateEpisodeSubtitles,
  generateSeriesMetadata,
  getAiJob,
  getSeriesTranscript,
  jobOutcomeText,
  jobQueuedText,
  pollAiJob,
  reembedAll,
  refreshSeriesEmbeddings,
  translateSeries,
} from "./ai";

describe("aiErrorMessage", () => {
  it("explains unavailable and provider errors", () => {
    expect(aiErrorMessage(new ApiError("x", 500, "ai_unavailable"))).toMatch(/unavailable/);
    expect(aiErrorMessage(new ApiError("x", 503))).toMatch(/unavailable/);
    expect(aiErrorMessage(new ApiError("bad key", 400, "ai_error"))).toBe("The AI provider returned an error: bad key");
    expect(aiErrorMessage(new ApiError("up", 502))).toBe("The AI provider returned an error: up");
    expect(aiErrorMessage(new ApiError("plain", 400))).toBe("plain");
    expect(aiErrorMessage(new Error("boom"))).toBe("boom");
    expect(aiErrorMessage("weird")).toBe("AI request failed");
    expect(aiErrorMessage(null, "custom")).toBe("custom");
  });
});

describe("ai endpoints", () => {
  it("send the right requests", async () => {
    mockApi.post("/v1/admin/ai/series-metadata", { ok: 1 });
    mockApi.post("/v1/admin/ai/series/s1/translate", { queued: true });
    mockApi.post("/v1/admin/ai/series/s1/embeddings", { queued: true });
    mockApi.get("/v1/admin/ai/series/s1/transcript", { text: "t" });
    mockApi.post("/v1/admin/ai/reembed-all", { queued: true });
    mockApi.post("/v1/admin/ai/episodes/e1/subtitles", { queued: true });
    mockApi.get("/v1/admin/ai/jobs/j1", { job_id: "j1", status: "running" });

    await generateSeriesMetadata({ seed: "x" } as never);
    expect(mockApi.calls[0].body).toEqual({ seed: "x" });
    await translateSeries("s1");
    expect(mockApi.calls[1].body).toEqual({ languages: null });
    await translateSeries("s1", ["hi"]);
    expect(mockApi.calls[2].body).toEqual({ languages: ["hi"] });
    await refreshSeriesEmbeddings("s1");
    await getSeriesTranscript("s1");
    expect(mockApi.calls[4].query).toEqual({ episodes: "3" });
    await getSeriesTranscript("s1", 5);
    expect(mockApi.calls[5].query).toEqual({ episodes: "5" });
    await reembedAll();
    await generateEpisodeSubtitles("e1");
    expect(mockApi.calls[7].body).toEqual({ languages: null });
    expect(await getAiJob("j1")).toEqual({ job_id: "j1", status: "running" });
    mockApi.get("/v1/admin/ai/jobs/j1", fail(503, { code: "ai_unavailable", message: "down" }));
    await expect(getAiJob("j1")).rejects.toMatchObject({ code: "ai_unavailable" });
  });
});

describe("pollAiJob", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reports the terminal job once", async () => {
    let n = 0;
    mockApi.get("/v1/admin/ai/jobs/j1", () => ({ job_id: "j1", status: ++n < 2 ? "running" : "complete" }));
    const done = vi.fn();
    pollAiJob("j1", done);
    await vi.advanceTimersByTimeAsync(0);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(done).toHaveBeenCalledWith({ job_id: "j1", status: "complete" }, false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(done).toHaveBeenCalledTimes(1);
  });
  it.each(["failed", "not_found"])("treats %s as terminal", async (status) => {
    mockApi.get("/v1/admin/ai/jobs/j1", { job_id: "j1", status });
    const done = vi.fn();
    pollAiJob("j1", done);
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toHaveBeenCalledWith({ job_id: "j1", status }, false);
  });
  it("gives up after three minutes with a synthetic running job", async () => {
    mockApi.get("/v1/admin/ai/jobs/j1", { job_id: "j1", status: "running" });
    const done = vi.fn();
    pollAiJob("j1", done);
    await vi.advanceTimersByTimeAsync(AI_JOB_TIMEOUT_MS + 4000);
    expect(done).toHaveBeenCalledWith({ job_id: "j1", status: "running" }, true);
  });
});

describe("job text", () => {
  it("describes queueing", () => {
    expect(jobQueuedText("Translate", { queued: true, job_id: "j" } as never)).toBe("Translate queued (job j)");
    expect(jobQueuedText("Translate", { queued: true } as never)).toBe("Translate queued");
    expect(jobQueuedText("Translate", { queued: false } as never)).toBe("Translate: nothing to do");
  });
  it("describes outcomes", () => {
    const job = (status: string, extra = {}) => ({ job_id: "j", status, ...extra }) as never;
    expect(jobOutcomeText("T", job("running"), true)).toEqual({ ok: false, text: expect.stringContaining("still running after 3 minutes") });
    expect(jobOutcomeText("T", job("complete"), false)).toEqual({ ok: true, text: "T finished." });
    expect(jobOutcomeText("T", job("not_found"), false).text).toBe("T: job j was not found.");
    expect(jobOutcomeText("T", job("failed", { error: "oops" }), false).text).toBe("T failed: oops.");
    expect(jobOutcomeText("T", job("failed"), false).text).toBe("T failed.");
  });
});
