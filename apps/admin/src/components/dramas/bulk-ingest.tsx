"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { api, call, type Schemas } from "@/lib/api";
import { useToast } from "@/components/toast";
import { Button, Field, Modal, Select, Toggle } from "@/components/ui";
import { isCancelled, MAX_VIDEO_BYTES, uploadVideo } from "@/lib/uploads";

/**
 * Bulk episode ingest.
 *
 * Publishing a season used to be the single largest recurring cost in the product: one modal per episode, one
 * file at a time, roughly four hundred interactions for sixty episodes — and closing the modal aborted the
 * upload, so nothing could run in the background.
 *
 * Here an operator selects the whole season at once. Episode numbers are read from the filenames (01.mp4,
 * ep_12.mp4, "Show - 07.mp4"), which is how the files arrive from an edit house, and only a file whose name
 * yields no number falls back to sequential numbering from the first free slot. A file whose number is already
 * on the series keeps that number: by default it is skipped, so dropping the same folder twice cannot duplicate
 * anything, and with the replace toggle on its video replaces the existing episode's. (The API refuses two
 * episodes with one number, so "allow duplicates" was never something this dialog could offer.) Uploads run
 * with a small amount of concurrency, each row reports its own progress, and a failure is per-file rather than
 * per-batch.
 */

type Episode = Schemas["AdminEpisodeOut"];

type Row = {
  file: File;
  number: number;
  /** The episode already holding this number, when there is one. */
  existing?: Episode;
  status: "queued" | "uploading" | "transcoding" | "done" | "error" | "skipped";
  progress: number;
  message?: string;
};

/** Episode number from a filename: the last standalone 1–4 digit run, ignoring resolution and codec tokens. */
export function numberFromFilename(name: string): number | null {
  const stem = name.replace(/\.[a-z0-9]+$/i, "");
  const cleaned = stem
    .replace(/\b\d{3,4}[pi]\b/gi, " ") // 1080p, 720i
    .replace(/\bx?26[45]\b/gi, " ")
    .replace(/\b(19|20)\d{2}\b/g, " "); // a year is not an episode number
  const matches = cleaned.match(/\d{1,4}/g);
  if (!matches) return null;
  const n = Number(matches[matches.length - 1]);
  return Number.isFinite(n) && n > 0 && n <= 9999 ? n : null;
}

const CONCURRENCY = 3;

export function BulkIngestDialog({
  open,
  seriesId,
  existing,
  onClose,
  onDone,
}: {
  open: boolean;
  seriesId: string;
  /** Episodes already on the series: a re-upload of one is skipped, or replaces its video when asked to. */
  existing: Episode[];
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"draft" | "review" | "published">("draft");
  const [dripDays, setDripDays] = useState(0);
  const [overwrite, setOverwrite] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const byNumber = useMemo(() => new Map(existing.map((e) => [e.number, e])), [existing]);
  const nextFree = useMemo(() => {
    let n = 1;
    while (byNumber.has(n)) n += 1;
    return n;
  }, [byNumber]);

  const pick = useCallback(
    (files: FileList | null) => {
      if (!files?.length) return;
      const list = Array.from(files).filter((f) => f.size > 0 && f.size <= MAX_VIDEO_BYTES);
      // Sort by parsed number when available so sequential fallback follows the operator's own ordering.
      const parsed = list.map((file) => ({ file, parsed: numberFromFilename(file.name) }));
      parsed.sort((a, b) => (a.parsed ?? Number.MAX_SAFE_INTEGER) - (b.parsed ?? Number.MAX_SAFE_INTEGER) || a.file.name.localeCompare(b.file.name));

      // Numbers claimed by this batch. A parsed number is kept even when the series already has it — that is
      // the case the skip/replace toggle exists for — so only unnamed files take a fallback slot.
      const claimed = new Set<number>();
      let fallback = nextFree;
      const next: Row[] = parsed.map(({ file, parsed: n }) => {
        let number = n;
        if (number == null) {
          while (byNumber.has(fallback) || claimed.has(fallback)) fallback += 1;
          number = fallback;
        }
        if (claimed.has(number)) {
          // Two files in one drop naming the same episode: whichever sorted first wins, the other is left out
          // rather than racing it to the API.
          return { file, number, status: "skipped", progress: 0, message: "Same number as another file" };
        }
        claimed.add(number);
        return { file, number, existing: byNumber.get(number), status: "queued", progress: 0 };
      });
      setRows(next);
    },
    [byNumber, nextFree],
  );

  const patch = useCallback((index: number, changes: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...changes } : r)));
  }, []);

  const run = useCallback(async () => {
    if (!rows.length) return;
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const started = Date.now();
    let ok = 0;
    let failed = 0;

    const work = rows.map((row, index) => async () => {
      if (controller.signal.aborted || row.status === "skipped") return;
      if (row.existing && !overwrite) {
        patch(index, { status: "skipped", message: `Episode ${row.number} already exists` });
        return;
      }
      try {
        patch(index, { status: "uploading", progress: 0 });
        const asset = await uploadVideo(row.file, (f) => patch(index, { progress: f }), controller.signal);
        patch(index, { status: "transcoding", progress: 1 });

        // Drip scheduling: `review` plus a scheduled time is what the publish cron acts on.
        const scheduledAt =
          dripDays > 0 ? new Date(started + index * dripDays * 86_400_000).toISOString() : undefined;
        if (row.existing) {
          // Replace: the episode keeps its title, thumbnail and pricing; only the video (and the publish
          // choice made in this dialog) changes. An embed is dropped because the file now is the video.
          const ep = row.existing;
          await call(
            api.PUT("/v1/admin/episodes/{episode_id}", {
              params: { path: { episode_id: ep.id } },
              body: {
                number: ep.number,
                title: ep.title ?? null,
                thumbnail_url: ep.thumbnail_url ?? null,
                video_asset_id: asset.id,
                embed_html: null,
                price_override: ep.price_override ?? null,
                is_free_override: ep.is_free_override ?? null,
                status: scheduledAt ? "review" : status,
                scheduled_at: scheduledAt ?? null,
              },
            }),
          );
        } else {
          await call(
            api.POST("/v1/admin/series/{series_id}/episodes", {
              params: { path: { series_id: seriesId } },
              body: {
                number: row.number,
                status: scheduledAt ? "review" : status,
                video_asset_id: asset.id,
                ...(scheduledAt ? { scheduled_at: scheduledAt } : {}),
              },
            }),
          );
        }
        patch(index, { status: "done" });
        ok += 1;
      } catch (err) {
        if (isCancelled(err)) {
          patch(index, { status: "skipped", message: "Cancelled" });
          return;
        }
        failed += 1;
        patch(index, { status: "error", message: err instanceof Error ? err.message : "Upload failed" });
      }
    });

    // A small pool rather than all at once: a season of 2GB files would otherwise saturate the uplink and time
    // every request out together.
    const queue = [...work];
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (let job = queue.shift(); job; job = queue.shift()) await job();
      }),
    );

    setBusy(false);
    abortRef.current = null;
    if (ok) toast.success(`${ok} episode${ok === 1 ? "" : "s"} ingested${failed ? `, ${failed} failed` : ""}`);
    else if (failed) toast.error(`All ${failed} uploads failed`);
    if (ok) onDone();
  }, [rows, overwrite, patch, dripDays, seriesId, status, toast, onDone]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setBusy(false);
  }, []);

  const close = useCallback(() => {
    if (busy) return;
    setRows([]);
    onClose();
  }, [busy, onClose]);

  const done = rows.filter((r) => r.status === "done").length;
  /** What pressing Ingest will actually send, given the current toggle. */
  const pending = rows.filter((r) => r.status === "queued" && (overwrite || !r.existing)).length;

  return (
    <Modal
      open={open}
      onClose={close}
      dismissible={!busy}
      title="Ingest a season"
      width="max-w-2xl"
      footer={
        <>
          <Button onClick={busy ? cancel : close}>{busy ? "Stop" : "Close"}</Button>
          <Button variant="primary" onClick={() => void run()} loading={busy} disabled={!pending || busy}>
            {busy ? `Uploading ${done}/${rows.length}` : `Ingest ${pending || ""} file${pending === 1 ? "" : "s"}`}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field
          label="Video files"
          hint="Episode numbers are read from the filenames (01.mp4, ep_12.mp4). Anything unrecognised is numbered in order from the first free slot."
        >
          <input
            type="file"
            accept="video/*"
            multiple
            data-autofocus
            disabled={busy}
            onChange={(e) => pick(e.target.files)}
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:text-ink"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Publish as">
            <Select value={status} disabled={busy || dripDays > 0} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="draft">Draft</option>
              <option value="review">Review</option>
              <option value="published">Published</option>
            </Select>
          </Field>
          <Field label="Release one every" hint="0 publishes them together. Otherwise they are scheduled and released by the cron.">
            <Select value={dripDays} disabled={busy} onChange={(e) => setDripDays(Number(e.target.value))}>
              <option value={0}>All at once</option>
              <option value={1}>1 day</option>
              <option value={2}>2 days</option>
              <option value={3}>3 days</option>
              <option value={7}>7 days</option>
            </Select>
          </Field>
        </div>

        <Toggle
          checked={overwrite}
          onChange={setOverwrite}
          disabled={busy}
          label="Replace episodes that already exist"
          description="Off: a file whose number is already on the series is skipped, so dropping the same folder twice changes nothing. On: its video replaces that episode's, keeping the title, thumbnail and pricing."
        />

        {rows.length > 0 && (
          <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {rows.map((row, i) => (
              <li key={`${row.file.name}-${i}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-12 shrink-0 font-medium tabular-nums text-ink">#{row.number}</span>
                <span className="min-w-0 flex-1 truncate text-ink-2" title={row.file.name}>
                  {row.file.name}
                </span>
                <span className="w-32 shrink-0 text-right text-xs text-muted">
                  {row.status === "uploading"
                    ? `${Math.round(row.progress * 100)}%`
                    : row.status === "error" || row.status === "skipped"
                      ? row.message
                      : row.status === "queued" && row.existing
                        ? overwrite
                          ? "will replace"
                          : "exists · will skip"
                        : row.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
