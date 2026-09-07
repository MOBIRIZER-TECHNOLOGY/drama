"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { aiErrorMessage, jobOutcomeText, jobQueuedText, pollAiJob, refreshSeriesEmbeddings, translateSeries } from "@/lib/ai";
import { api, call } from "@/lib/api";
import { seriesTitle } from "@/lib/series";
import { useQuery } from "@/lib/use-query";
import { EpisodesPanel } from "@/components/dramas/episodes-panel";
import { SeriesForm } from "@/components/dramas/series-form";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { Badge, Button, ErrorState, InlineError, LoadingState, Modal, PageHeader, statusTone } from "@/components/ui";

export default function SeriesDetailPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const { data, loading, error, refetch, setData } = useQuery(`series:${id}`, () =>
    call(api.GET("/v1/admin/series/{series_id}", { params: { path: { series_id: id } } })),
  );

  // The form re-seeds from the server copy whenever updated_at changes, unless the admin has
  // unsaved edits: then the key is frozen and a banner offers to reload.
  const [dirty, setDirty] = useState(false);
  const [frozenAt, setFrozenAt] = useState<string | null>(null);
  const updatedAt = data?.updated_at ?? "";
  // Stable callback (read the timestamp through a ref) so the form's dirty effect only fires on
  // real transitions; otherwise a server change would re-freeze to the new timestamp and remount.
  const updatedAtRef = useRef(updatedAt);
  useEffect(() => {
    updatedAtRef.current = updatedAt;
  });
  const onDirtyChange = useCallback((d: boolean) => {
    setDirty(d);
    setFrozenAt(d ? updatedAtRef.current : null);
  }, []);
  const formKey = dirty && frozenAt ? frozenAt : updatedAt;
  const changedOnServer = dirty && frozenAt != null && frozenAt !== updatedAt;

  const [aiBusy, setAiBusy] = useState<"translate" | "embeddings" | null>(null);
  const [translateOpen, setTranslateOpen] = useState(false);
  const jobStops = useRef(new Set<() => void>());
  useEffect(() => {
    const stops = jobStops.current;
    return () => stops.forEach((stop) => stop());
  }, []);

  function watchJob(what: string, jobId: string, onComplete?: () => void) {
    const stop = pollAiJob(jobId, (job, timedOut) => {
      jobStops.current.delete(stop);
      const { ok, text } = jobOutcomeText(what, job, timedOut);
      if (ok) {
        toast.success(text);
        onComplete?.();
      } else {
        toast.error(text);
      }
    });
    jobStops.current.add(stop);
  }

  async function runTranslate(languages: string[] | null) {
    if (!data) return;
    setAiBusy("translate");
    try {
      const job = await translateSeries(data.id, languages);
      toast.info(jobQueuedText("Translation", job));
      if (job.queued && job.job_id) watchJob("Translation", job.job_id, refetch);
      setTranslateOpen(false);
    } catch (e) {
      toast.error(aiErrorMessage(e));
    } finally {
      setAiBusy(null);
    }
  }

  async function runEmbeddings() {
    if (!data) return;
    setAiBusy("embeddings");
    try {
      const job = await refreshSeriesEmbeddings(data.id);
      toast.info(jobQueuedText("Embedding refresh", job));
      if (job.queued && job.job_id) watchJob("Embedding refresh", job.job_id);
    } catch (e) {
      toast.error(aiErrorMessage(e));
    } finally {
      setAiBusy(null);
    }
  }

  const title = data ? seriesTitle(data) : "Series";

  return (
    <>
      <PageHeader
        title={data ? title : "Series"}
        description={data ? `/${data.slug}` : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {data && <Badge tone={statusTone(data.status)}>{data.status}</Badge>}
            {data && (
              <>
                <Button size="sm" loading={aiBusy === "translate"} disabled={aiBusy != null} onClick={() => setTranslateOpen(true)}>
                  <Icon name="globe" size={14} /> Translate with AI
                </Button>
                <Button size="sm" loading={aiBusy === "embeddings"} disabled={aiBusy != null} onClick={runEmbeddings}>
                  <Icon name="refresh" size={14} /> Refresh embeddings
                </Button>
              </>
            )}
            <Link href="/dramas" className="text-sm text-muted hover:text-ink">
              ← Back to dramas
            </Link>
          </div>
        }
      />
      {error && data && <InlineError message={error} onRetry={refetch} />}
      {changedOnServer && (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-ink-2">
          <span className="flex-1">This series changed on the server while you were editing. Reload to see the latest version; your unsaved edits will be discarded.</span>
          <Button size="sm" onClick={() => onDirtyChange(false)}>
            Reload form
          </Button>
        </div>
      )}
      {error && !data ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : !data ? (
        <LoadingState />
      ) : (
        <div className="flex flex-col gap-8" aria-busy={loading}>
          <EpisodesPanel seriesId={data.id} episodes={data.episodes} onChanged={refetch} />
          <SeriesForm key={formKey} initial={data} onSaved={(s) => setData(s)} onDirtyChange={onDirtyChange} />
        </div>
      )}

      {data && translateOpen && (
        <TranslateDialog
          originalLanguage={data.original_language}
          existing={data.translations.map((t) => t.lang)}
          busy={aiBusy === "translate"}
          onClose={() => setTranslateOpen(false)}
          onConfirm={runTranslate}
        />
      )}
    </>
  );
}

function TranslateDialog({
  originalLanguage,
  existing,
  busy,
  onClose,
  onConfirm,
}: {
  originalLanguage: string;
  existing: string[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (languages: string[] | null) => void;
}) {
  const languages = useQuery("languages", () => call(api.GET("/v1/admin/languages")));
  const targets = (languages.data ?? []).filter((l) => l.is_active && l.code !== originalLanguage);
  const [selected, setSelected] = useState<Set<string> | null>(null); // null = all targets
  const chosen = selected ?? new Set(targets.map((t) => t.code));
  const allChosen = targets.length > 0 && chosen.size === targets.length;

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!busy}
      title="Translate with AI"
      width="max-w-md"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={chosen.size === 0 || !languages.data} onClick={() => onConfirm(allChosen ? null : [...chosen])}>
            Queue translation ({chosen.size})
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-ink-2">
        Translates the title, synopsis and SEO fields from <strong>{originalLanguage}</strong> into the selected languages. Existing translations are overwritten with source
        <em> ai</em>; human edits should be re-checked afterwards.
      </p>
      {languages.error ? (
        <p className="text-sm text-danger">{languages.error}</p>
      ) : !languages.data ? (
        <LoadingState label="Loading languages…" />
      ) : targets.length === 0 ? (
        <p className="text-sm text-muted">No other active languages. Add one under Languages first.</p>
      ) : (
        <fieldset className="grid gap-2">
          <legend className="sr-only">Target languages</legend>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={allChosen} onChange={(e) => setSelected(e.target.checked ? null : new Set())} data-autofocus />
            All active languages
          </label>
          {targets.map((l) => (
            <label key={l.code} className="ml-5 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={chosen.has(l.code)}
                onChange={(e) => {
                  const next = new Set(chosen);
                  if (e.target.checked) next.add(l.code);
                  else next.delete(l.code);
                  setSelected(next);
                }}
              />
              {l.name} <span className="font-mono text-xs text-muted">{l.code}</span>
              {existing.includes(l.code) && <Badge>has translation</Badge>}
            </label>
          ))}
        </fieldset>
      )}
    </Modal>
  );
}
