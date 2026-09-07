"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { aiErrorMessage, generateEpisodeSubtitles, jobOutcomeText, jobQueuedText, pollAiJob } from "@/lib/ai";
import { api, call, type Schemas } from "@/lib/api";
import { fmtDateTime, fromLocalInput, toLocalInput } from "@/lib/format";
import { useFieldErrors, validateEmbedHtml } from "@/lib/forms";
import {
  isCancelled,
  MAX_VIDEO_BYTES,
  PENDING_ASSET_STATUS,
  pollAssets,
  pollVideo,
  retryVideo,
  uploadVideo,
  type VideoAsset,
} from "@/lib/uploads";
import { ImageUpload } from "@/components/image-upload";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { BulkIngestDialog } from "./bulk-ingest";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Table,
  Td,
  Textarea,
  Th,
  statusTone,
} from "@/components/ui";
import { PUBLISH_STATUSES } from "./series-form";

type Episode = Schemas["AdminEpisodeOut"];
type EpisodeIn = Schemas["EpisodeIn"];
type PublishStatus = Schemas["PublishStatus"];

export function EpisodesPanel({
  seriesId,
  episodes,
  onChanged,
}: {
  seriesId: string;
  episodes: Episode[];
  onChanged: () => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState<Episode | "new" | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [ingestOpen, setIngestOpen] = useState(false);
  const [deleting, setDeleting] = useState<Episode | null>(null);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [subtitling, setSubtitling] = useState<string | null>(null);
  const jobStops = useRef(new Set<() => void>());

  const sorted = [...episodes].sort((a, b) => a.number - b.number);
  const nextNumber = sorted.length ? sorted[sorted.length - 1].number + 1 : 1;

  // Poll only the assets still transcoding, and only while no episode dialog is open
  // (the dialog owns polling for the asset it is editing).
  const pendingIds = episodes
    .filter((e) => e.video_asset_id && e.asset_status && PENDING_ASSET_STATUS.has(e.asset_status))
    .map((e) => e.video_asset_id as string)
    .sort()
    .join(",");
  const dialogOpen = editing != null;
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  });
  useEffect(() => {
    if (!pendingIds || dialogOpen) return;
    return pollAssets(pendingIds.split(","), () => onChangedRef.current());
  }, [pendingIds, dialogOpen]);

  useEffect(() => {
    const stops = jobStops.current;
    return () => stops.forEach((stop) => stop());
  }, []);

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await call(api.DELETE("/v1/admin/episodes/{episode_id}", { params: { path: { episode_id: deleting.id } } }));
      toast.success(`Episode ${deleting.number} deleted`);
      setDeleting(null);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function retry(ep: Episode) {
    if (!ep.video_asset_id) return;
    setRetrying(ep.id);
    try {
      await retryVideo(ep.video_asset_id);
      toast.info("Transcode re-queued");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setRetrying(null);
    }
  }

  async function subtitles(ep: Episode) {
    setSubtitling(ep.id);
    const what = `Subtitles for episode ${ep.number}`;
    try {
      const job = await generateEpisodeSubtitles(ep.id);
      toast.info(jobQueuedText(what, job));
      if (job.queued && job.job_id) {
        const stop = pollAiJob(job.job_id, (done, timedOut) => {
          jobStops.current.delete(stop);
          const { ok, text } = jobOutcomeText(what, done, timedOut);
          if (ok) toast.success(text);
          else toast.error(text);
        });
        jobStops.current.add(stop);
      }
    } catch (e) {
      toast.error(aiErrorMessage(e));
    } finally {
      setSubtitling(null);
    }
  }

  return (
    <Card
      title={`Episodes (${episodes.length})`}
      actions={
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setBulkOpen(true)}>
            Add N episodes
          </Button>
          <Button size="sm" onClick={() => setIngestOpen(true)}>
            <Icon name="plus" size={14} /> Ingest season
          </Button>
          <Button size="sm" variant="primary" onClick={() => setEditing("new")}>
            <Icon name="plus" size={14} /> Add episode
          </Button>
        </div>
      }
    >
      {sorted.length === 0 ? (
        <EmptyState
          title="No episodes yet"
          description="Add episodes one by one, or create numbered drafts in bulk and fill them in later."
        />
      ) : (
        <Table minWidth={820}>
          <thead>
            <tr>
              <Th>#</Th>
              <Th>Title</Th>
              <Th>Video</Th>
              <Th>Pricing</Th>
              <Th>Status</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((ep) => (
              <tr key={ep.id} className="hover:bg-surface-2/50">
                <Td className="w-12 tabular-nums text-muted">{ep.number}</Td>
                <Td>
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-7 shrink-0 overflow-hidden rounded bg-surface-2">
                      {ep.thumbnail_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={ep.thumbnail_url} alt="" className="h-full w-full object-cover" />
                      )}
                    </div>
                    <span className="font-medium">{ep.title || <span className="text-muted">Untitled</span>}</span>
                  </div>
                </Td>
                <Td>
                  <VideoCell ep={ep} retrying={retrying === ep.id} onRetry={() => retry(ep)} />
                </Td>
                <Td className="text-xs text-ink-2">
                  {ep.is_free_override === true ? (
                    <Badge tone="success">free</Badge>
                  ) : ep.is_free_override === false ? (
                    <Badge tone="warning">paid</Badge>
                  ) : (
                    <span className="text-muted">inherit</span>
                  )}
                  {ep.price_override != null && <span className="ml-2">{ep.price_override} coins</span>}
                </Td>
                <Td>
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge tone={statusTone(ep.status)}>{ep.status}</Badge>
                    {isScheduled(ep) && (
                      <span title={`Publishes ${fmtDateTime(ep.scheduled_at)}`}>
                        <Badge tone="accent">scheduled</Badge>
                      </span>
                    )}
                  </div>
                  {isScheduled(ep) && <span className="mt-0.5 block text-[11px] text-muted">{fmtDateTime(ep.scheduled_at)}</span>}
                </Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={subtitling === ep.id}
                      disabled={!canSubtitle(ep)}
                      title={canSubtitle(ep) ? "Generate subtitles with AI" : "Needs a video asset that has finished transcoding"}
                      onClick={() => subtitles(ep)}
                    >
                      Subtitles
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(ep)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" aria-label={`Delete episode ${ep.number}`} onClick={() => setDeleting(ep)}>
                      <Icon name="trash" size={14} className="text-danger" />
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {editing && (
        <EpisodeDialog
          seriesId={seriesId}
          episode={editing === "new" ? null : editing}
          defaultNumber={nextNumber}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}

      <BulkAddDialog
        open={bulkOpen}
        seriesId={seriesId}
        startAt={nextNumber}
        onClose={() => setBulkOpen(false)}
        onDone={() => {
          setBulkOpen(false);
          onChanged();
        }}
      />

      <BulkIngestDialog
        open={ingestOpen}
        seriesId={seriesId}
        existingNumbers={episodes.map((e) => e.number)}
        onClose={() => setIngestOpen(false)}
        onDone={onChanged}
      />

      <ConfirmDialog
        open={deleting != null}
        title="Delete episode"
        message={`Delete episode ${deleting?.number ?? ""}${deleting?.title ? ` “${deleting.title}”` : ""}? Viewers who unlocked it lose access.`}
        loading={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </Card>
  );
}

/** Drip release: a review episode with a publish time the worker will act on. */
function isScheduled(ep: Episode): boolean {
  return Boolean(ep.scheduled_at) && ep.status === "review";
}

function canSubtitle(ep: Episode): boolean {
  return Boolean(ep.video_asset_id) && ep.asset_status === "ready";
}

function VideoCell({ ep, retrying, onRetry }: { ep: Episode; retrying: boolean; onRetry: () => void }) {
  if (ep.video_asset_id) {
    const st = ep.asset_status ?? "queued";
    return (
      <div className="flex items-center gap-2">
        <Badge tone={statusTone(st)}>{st}</Badge>
        {ep.duration_sec != null && <span className="text-xs text-muted">{formatDuration(ep.duration_sec)}</span>}
        {st === "failed" && (
          <Button size="sm" variant="ghost" loading={retrying} onClick={onRetry}>
            <Icon name="refresh" size={13} /> Retry
          </Button>
        )}
      </div>
    );
  }
  if (ep.embed_html) return <Badge tone="neutral">embed</Badge>;
  return <span className="text-xs text-muted">no video</span>;
}

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* ---------- add / edit dialog ---------- */

type VideoMode = "keep" | "upload" | "embed" | "none";
type EpErrorKey = "number" | "video" | "embed" | "price" | "scheduled_at";

function EpisodeDialog({
  seriesId,
  episode,
  defaultNumber,
  onClose,
  onSaved,
}: {
  seriesId: string;
  episode: Episode | null;
  defaultNumber: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { errors, setErrors, clearError, formRef } = useFieldErrors<EpErrorKey>();
  const [number, setNumber] = useState(episode?.number ?? defaultNumber);
  const [title, setTitle] = useState(episode?.title ?? "");
  const [thumb, setThumb] = useState<string | null>(episode?.thumbnail_url ?? null);
  const [mode, setMode] = useState<VideoMode>(episode?.video_asset_id ? "keep" : episode?.embed_html ? "embed" : "none");
  const [embed, setEmbed] = useState(episode?.embed_html ?? "");
  const [price, setPrice] = useState(episode?.price_override == null ? "" : String(episode.price_override));
  const [free, setFree] = useState<"inherit" | "free" | "paid">(
    episode?.is_free_override === true ? "free" : episode?.is_free_override === false ? "paid" : "inherit",
  );
  const [status, setStatus] = useState<PublishStatus>(episode?.status ?? "draft");
  const [scheduledAt, setScheduledAt] = useState(toLocalInput(episode?.scheduled_at));
  const [saving, setSaving] = useState(false);

  // upload state: the dialog owns polling for its asset and aborts the upload on unmount
  const [asset, setAsset] = useState<VideoAsset | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stopPoll = useRef<() => void>(() => {});
  const abortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      stopPoll.current();
      abortRef.current?.abort();
    },
    [],
  );

  // While "keep" is selected and the existing asset is still transcoding, watch it here.
  const keepAssetId = mode === "keep" ? episode?.video_asset_id : null;
  const keepPending = keepAssetId && episode?.asset_status && PENDING_ASSET_STATUS.has(episode.asset_status);
  useEffect(() => {
    if (!keepAssetId || !keepPending) return;
    return pollVideo(keepAssetId, setAsset, setPollError);
  }, [keepAssetId, keepPending]);

  function watch(id: string) {
    stopPoll.current();
    stopPoll.current = pollVideo(
      id,
      (a) => {
        setAsset(a);
        setPollError(null);
      },
      setPollError,
    );
  }

  async function pickVideo(file: File | undefined) {
    if (!file) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress(0);
    setAsset(null);
    clearError("video");
    try {
      const a = await uploadVideo(file, setProgress, controller.signal);
      setAsset(a);
      toast.success("Video uploaded; transcoding queued");
      watch(a.id);
    } catch (e) {
      if (!isCancelled(e)) toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function retryAsset() {
    if (!asset) return;
    try {
      const a = await retryVideo(asset.id);
      setAsset(a);
      watch(a.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Retry failed");
    }
  }

  function validate(): boolean {
    const next: Partial<Record<EpErrorKey, string>> = {};
    if (!Number.isInteger(number) || number < 1) next.number = "Episode number must be 1 or more.";
    if (mode === "upload" && !asset) next.video = "Choose a video file first, or switch to another video source.";
    if (mode === "embed") {
      const err = validateEmbedHtml(embed);
      if (err) next.embed = err;
    }
    if (price !== "" && (!Number.isInteger(Number(price)) || Number(price) < 0)) next.price = "Must be a whole number of coins (or blank).";
    if (scheduledAt && status === "published") next.scheduled_at = "A published episode is already live; clear the schedule or set the status to review.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    const body: EpisodeIn = {
      number,
      title: title.trim() || null,
      thumbnail_url: thumb || null,
      video_asset_id: mode === "keep" ? (episode?.video_asset_id ?? null) : mode === "upload" ? (asset?.id ?? null) : null,
      embed_html: mode === "embed" ? embed.trim() || null : null,
      price_override: price === "" ? null : Number(price),
      is_free_override: free === "inherit" ? null : free === "free",
      status,
      scheduled_at: fromLocalInput(scheduledAt),
    };
    setSaving(true);
    try {
      if (episode) {
        await call(api.PUT("/v1/admin/episodes/{episode_id}", { params: { path: { episode_id: episode.id } }, body }));
      } else {
        await call(api.POST("/v1/admin/series/{series_id}/episodes", { params: { path: { series_id: seriesId } }, body }));
      }
      toast.success(episode ? "Episode saved" : "Episode added");
      onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      if (mode === "embed" && /embed|iframe/i.test(msg)) setErrors({ embed: msg });
      else toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  const formId = "episode-form";
  const uploading = progress != null;

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!saving && !uploading}
      title={episode ? `Edit episode ${episode.number}` : "Add episode"}
      width="max-w-2xl"
      footer={
        <>
          <Button onClick={onClose} disabled={saving || uploading}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={saving} disabled={uploading}>
            {episode ? "Save" : "Add"}
          </Button>
        </>
      }
    >
      <form id={formId} ref={formRef} onSubmit={submit} className="grid gap-4 md:grid-cols-2" noValidate>
        <Field label="Number" required error={errors.number}>
          <Input
            type="number"
            min={1}
            value={number}
            data-autofocus
            onChange={(e) => {
              setNumber(Number(e.target.value));
              clearError("number");
            }}
          />
        </Field>
        <Field label="Title">
          <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </Field>

        <div className="md:col-span-2">
          <ImageUpload label="Thumbnail (9:16)" value={thumb} onChange={setThumb} aspect="portrait" />
        </div>

        <fieldset className="md:col-span-2">
          <legend className="mb-2 text-[13px] font-medium text-ink-2">Video source</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {episode?.video_asset_id && (
              <RadioOpt name="mode" value="keep" current={mode} onChange={setMode}>
                Keep current ({asset?.status ?? episode.asset_status ?? "asset"})
              </RadioOpt>
            )}
            <RadioOpt name="mode" value="upload" current={mode} onChange={setMode}>
              Upload file
            </RadioOpt>
            <RadioOpt name="mode" value="embed" current={mode} onChange={setMode}>
              Embed HTML
            </RadioOpt>
            <RadioOpt name="mode" value="none" current={mode} onChange={setMode}>
              None
            </RadioOpt>
          </div>

          {mode === "upload" && (
            <div className={`mt-3 rounded-lg border bg-surface-2/50 p-3 ${errors.video ? "border-danger" : "border-line"}`}>
              <input
                ref={fileRef}
                type="file"
                accept="video/*"
                aria-label="Video file"
                aria-invalid={errors.video ? true : undefined}
                className="sr-only"
                onChange={(e) => pickVideo(e.target.files?.[0])}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" loading={uploading} onClick={() => fileRef.current?.click()}>
                  <Icon name="upload" size={14} /> {asset ? "Replace file" : "Choose video"}
                </Button>
                {uploading && (
                  <>
                    <span className="text-xs text-muted" aria-live="polite">
                      Uploading {Math.round((progress ?? 0) * 100)}%
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => abortRef.current?.abort()}>
                      Cancel upload
                    </Button>
                  </>
                )}
                {asset && (
                  <span className="flex items-center gap-2 text-xs">
                    <Badge tone={statusTone(asset.status)}>{asset.status}</Badge>
                    {asset.duration_sec != null && <span className="text-muted">{formatDuration(asset.duration_sec)}</span>}
                    {asset.status === "failed" && (
                      <Button size="sm" variant="ghost" onClick={retryAsset}>
                        <Icon name="refresh" size={13} /> Retry
                      </Button>
                    )}
                  </span>
                )}
              </div>
              {uploading && (
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-line">
                  <div className="h-full bg-accent transition-all" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
                </div>
              )}
              {errors.video && (
                <p role="alert" className="mt-2 text-xs text-danger">
                  {errors.video}
                </p>
              )}
              {asset?.error && <p className="mt-2 text-xs text-danger">{asset.error}</p>}
              {pollError && <p className="mt-2 text-xs text-warning">Status check: {pollError}</p>}
              {asset && !["ready", "failed"].includes(asset.status) && (
                <p className="mt-2 text-xs text-muted">Transcoding runs in the background; you can save now and the status updates on the episode list.</p>
              )}
              {!asset && !uploading && <p className="mt-2 text-xs text-muted">MP4/MOV/WebM up to {Math.round(MAX_VIDEO_BYTES / 1024 ** 3)} GB.</p>}
            </div>
          )}

          {mode === "embed" && (
            <Field
              label="Embed HTML"
              className="mt-3"
              required
              error={errors.embed}
              hint="A single <iframe> from YouTube, YouTube no-cookie, Vimeo or Dailymotion (https)."
            >
              <Textarea
                value={embed}
                onChange={(e) => {
                  setEmbed(e.target.value);
                  clearError("embed");
                }}
                placeholder='<iframe src="https://www.youtube.com/embed/…"></iframe>'
                className="font-mono text-xs"
              />
            </Field>
          )}
        </fieldset>

        <Field label="Price override (coins)" hint="Blank inherits the series price." error={errors.price}>
          <Input
            type="number"
            min={0}
            value={price}
            placeholder="inherit"
            onChange={(e) => {
              setPrice(e.target.value);
              clearError("price");
            }}
          />
        </Field>
        <Field label="Free override">
          <Select value={free} onChange={(e) => setFree(e.target.value as typeof free)}>
            <option value="inherit">Inherit from series</option>
            <option value="free">Always free</option>
            <option value="paid">Always paid</option>
          </Select>
        </Field>
        <Field label="Status">
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as PublishStatus);
              clearError("scheduled_at");
            }}
          >
            {PUBLISH_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Scheduled for"
          error={errors.scheduled_at}
          hint="Drip release: the worker publishes this episode at that time. Set the status to review and leave it there."
        >
          <Input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => {
              setScheduledAt(e.target.value);
              clearError("scheduled_at");
            }}
          />
        </Field>
        {scheduledAt && status !== "review" && !errors.scheduled_at && (
          <p className="text-xs text-warning md:col-span-2">
            A schedule only takes effect while the status is <strong>review</strong>.
          </p>
        )}
      </form>
    </Modal>
  );
}

function RadioOpt<T extends string>({
  name,
  value,
  current,
  onChange,
  children,
}: {
  name: string;
  value: T;
  current: T;
  onChange: (v: T) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <input type="radio" name={name} value={value} checked={current === value} onChange={() => onChange(value)} className="accent-[var(--accent)]" />
      {children}
    </label>
  );
}

/* ---------- bulk add ---------- */

function BulkAddDialog({
  open,
  seriesId,
  startAt,
  onClose,
  onDone,
}: {
  open: boolean;
  seriesId: string;
  startAt: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [count, setCount] = useState(10);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);

  async function run(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setDone(0);
    let created = 0;
    try {
      for (let i = 0; i < count; i++) {
        await call(
          api.POST("/v1/admin/series/{series_id}/episodes", {
            params: { path: { series_id: seriesId } },
            body: { number: startAt + i, status: "draft" },
          }),
        );
        created++;
        setDone(created);
      }
      toast.success(`Added ${created} draft episodes (${startAt}–${startAt + created - 1})`);
      onDone();
    } catch (err) {
      toast.error(`${err instanceof Error ? err.message : "Failed"} — ${created} of ${count} created`);
      if (created > 0) onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!busy}
      title="Add numbered episodes"
      width="max-w-sm"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="bulk-form" variant="primary" loading={busy}>
            {busy ? `Creating ${done}/${count}` : "Create drafts"}
          </Button>
        </>
      }
    >
      <form id="bulk-form" onSubmit={run} className="grid gap-4">
        <Field label="How many" hint={`Episodes ${startAt}–${startAt + Math.max(1, count) - 1} will be created as drafts.`}>
          <Input
            type="number"
            min={1}
            max={200}
            value={count}
            data-autofocus
            onChange={(e) => setCount(Math.min(200, Math.max(1, Number(e.target.value) || 1)))}
          />
        </Field>
      </form>
    </Modal>
  );
}
