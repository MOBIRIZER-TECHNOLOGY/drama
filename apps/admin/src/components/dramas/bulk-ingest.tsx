"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { api, call } from "@/lib/api";
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
 * ep_12.mp4, "Show - 07.mp4"), which is how the files arrive from an edit house, and anything unparsed falls
 * back to sequential numbering from the first free slot. Uploads run with a small amount of concurrency, each
 * row reports its own progress, and a failure is per-file rather than per-batch.
 */

type Row = {
  file: File;
  number: number;
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
  existingNumbers,
  onClose,
  onDone,
}: {
  open: boolean;
  seriesId: string;
  /** Episode numbers already on the series, so an accidental re-upload does not create duplicates. */
  existingNumbers: number[];
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

  const taken = useMemo(() => new Set(existingNumbers), [existingNumbers]);
  const nextFree = useMemo(() => {
    let n = 1;
    while (taken.has(n)) n += 1;
    return n;
  }, [taken]);

  const pick = useCallback(
    (files: FileList | null) => {
      if (!files?.length) return;
      const list = Array.from(files).filter((f) => f.size > 0 && f.size <= MAX_VIDEO_BYTES);
      // Sort by parsed number when available so sequential fallback follows the operator's own ordering.
      const parsed = list.map((file) => ({ file, parsed: numberFromFilename(file.name) }));
      parsed.sort((a, b) => (a.parsed ?? Number.MAX_SAFE_INTEGER) - (b.parsed ?? Number.MAX_SAFE_INTEGER) || a.file.name.localeCompare(b.file.name));

      const used = new Set(taken);
      let fallback = nextFree;
      const next: Row[] = parsed.map(({ file, parsed: n }) => {
        let number = n;
        if (number == null || used.has(number)) {
          while (used.has(fallback)) fallback += 1;
          number = fallback;
        }
        used.add(number);
        return { file, number, status: "queued", progress: 0 };
      });
      setRows(next);
    },
    [taken, nextFree],
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
      if (controller.signal.aborted) return;
      if (!overwrite && taken.has(row.number)) {
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
  }, [rows, overwrite, taken, patch, dripDays, seriesId, status, toast, onDone]);

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
          <Button variant="primary" onClick={() => void run()} loading={busy} disabled={!rows.length || busy}>
            {busy ? `Uploading ${done}/${rows.length}` : `Ingest ${rows.length || ""} file${rows.length === 1 ? "" : "s"}`}
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
          label="Allow numbers that already exist"
          description="Off by default, so a repeated drop of the same folder skips rather than duplicates."
        />

        {rows.length > 0 && (
          <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {rows.map((row, i) => (
              <li key={`${row.file.name}-${i}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-12 shrink-0 font-medium tabular-nums text-ink">#{row.number}</span>
                <span className="min-w-0 flex-1 truncate text-ink-2" title={row.file.name}>
                  {row.file.name}
                </span>
                <span className="w-28 shrink-0 text-right text-xs text-muted">
                  {row.status === "uploading"
                    ? `${Math.round(row.progress * 100)}%`
                    : row.status === "error" || row.status === "skipped"
                      ? row.message
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
