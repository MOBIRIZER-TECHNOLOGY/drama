"use client";

import { useRef, useState } from "react";
import { aiErrorMessage, generateSeriesMetadata, getSeriesTranscript, type MetadataDraft } from "@/lib/ai";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, Field, Select, Textarea, Toggle } from "@/components/ui";

export function AiMetadataPanel({
  languageOptions,
  currentLanguage,
  existingTitle,
  existingSynopsis,
  isCreate,
  seriesId,
  onApply,
}: {
  /** Names shown in the language select (e.g. "English", "Hindi"). */
  languageOptions: string[];
  /** Name of the language of the active translation tab. */
  currentLanguage: string;
  existingTitle: string;
  existingSynopsis: string;
  isCreate: boolean;
  /** When set, the seed can be prefilled from the series' episode transcripts. */
  seriesId?: string;
  onApply: (draft: MetadataDraft) => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState("");
  const [useExisting, setUseExisting] = useState(false);
  const [chosenLanguage, setChosenLanguage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<MetadataDraft | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const seedRef = useRef<HTMLTextAreaElement>(null);

  const language = chosenLanguage ?? currentLanguage;
  const options = [...new Set([language, ...languageOptions])];
  const hasExisting = Boolean(existingTitle.trim() || existingSynopsis.trim());

  async function prefillFromTranscript() {
    if (!seriesId) return;
    setTranscribing(true);
    setError(null);
    try {
      const out = await getSeriesTranscript(seriesId, 3);
      const text = out.text.trim();
      if (!text) {
        toast.info("No transcript yet: generate subtitles for the first episodes first.");
        return;
      }
      setSeed(text.slice(0, 4000));
      setSeedError(null);
      seedRef.current?.focus();
      toast.success(`Seeded from ${out.episodes} episode transcript(s).`);
    } catch (e) {
      const msg = aiErrorMessage(e, "Could not load the transcript");
      setError(msg);
      toast.error(msg);
    } finally {
      setTranscribing(false);
    }
  }

  async function generate() {
    const text = seed.trim();
    if (text.length < 3) {
      setSeedError("Give the AI a logline or a few notes (at least 3 characters).");
      seedRef.current?.focus();
      return;
    }
    setSeedError(null);
    setBusy(true);
    setError(null);
    try {
      const out = await generateSeriesMetadata({
        seed: text,
        language,
        title: useExisting && existingTitle.trim() ? existingTitle.trim() : null,
        synopsis: useExisting && existingSynopsis.trim() ? existingSynopsis.trim() : null,
      });
      setDraft(out);
    } catch (e) {
      const msg = aiErrorMessage(e);
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Generate with AI"
      actions={
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Hide" : "Show"}
        </Button>
      }
    >
      {open && (
        <div className="grid gap-4 px-5 py-4">
          <Field label="Seed" required error={seedError ?? undefined} hint="A logline, pitch notes or a pasted synopsis. The draft fills the active language tab.">
            <Textarea
              ref={seedRef}
              value={seed}
              maxLength={4000}
              placeholder="A widowed tea-stall owner discovers her late husband was a celebrated playback singer with a secret second family…"
              onChange={(e) => {
                setSeed(e.target.value);
                if (seedError) setSeedError(null);
              }}
            />
          </Field>
          <div className="grid gap-4 md:grid-cols-[220px_1fr] md:items-end">
            <Field label="Output language">
              <Select value={language} onChange={(e) => setChosenLanguage(e.target.value)}>
                {options.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            </Field>
            <Toggle
              label="Use existing title and synopsis"
              description={hasExisting ? "Sends the current tab's title/synopsis as context to refine rather than invent." : "Nothing on this tab yet."}
              checked={useExisting && hasExisting}
              disabled={!hasExisting}
              onChange={setUseExisting}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={generate} loading={busy}>
              <Icon name="globe" size={15} /> {draft ? "Regenerate" : "Generate draft"}
            </Button>
            {seriesId && (
              <Button onClick={prefillFromTranscript} loading={transcribing} title="Fill the seed from the first three episodes' subtitles">
                <Icon name="doc" size={15} /> Seed from transcript
              </Button>
            )}
          </div>

          {error && (
            <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          {draft && (
            <DraftPreview
              draft={draft}
              isCreate={isCreate}
              onApply={() => {
                onApply(draft);
                toast.success("Draft applied to the form; review before saving.");
              }}
            />
          )}
        </div>
      )}
    </Card>
  );
}

function DraftPreview({ draft, isCreate, onApply }: { draft: MetadataDraft; isCreate: boolean; onApply: () => void }) {
  const pct = Math.round(Math.max(0, Math.min(1, draft.confidence)) * 100);
  const tone = pct >= 70 ? "bg-success" : pct >= 40 ? "bg-warning" : "bg-danger";
  return (
    <section aria-label="AI draft" className="rounded-card border border-line bg-surface-2/40 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Draft</h3>
        <div className="flex items-center gap-2 text-xs text-muted" title={`Confidence ${pct}%`}>
          <span>Confidence</span>
          <span
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label="AI confidence"
            className="h-1.5 w-24 overflow-hidden rounded bg-line"
          >
            <span className={`block h-full ${tone}`} style={{ width: `${pct}%` }} />
          </span>
          <span className="tabular-nums">{pct}%</span>
        </div>
      </div>

      {draft.moderation_flags.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5" role="status">
          <span className="text-xs font-medium text-warning">Moderation:</span>
          {draft.moderation_flags.map((f) => (
            <Badge key={f} tone="warning">
              {f}
            </Badge>
          ))}
        </div>
      )}

      <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">
        <Row label="Title" value={draft.title} />
        <Row label="Slug" value={<span className="font-mono text-xs">{draft.slug}</span>} muted={!isCreate} hint={isCreate ? undefined : "kept as is when editing"} />
        <Row label="Synopsis" value={<span className="whitespace-pre-wrap">{draft.synopsis}</span>} wide />
        <Row label="Genres" value={<Chips items={draft.genres} />} />
        <Row label="Tags" value={<Chips items={draft.tags} />} />
        <Row label="SEO title" value={draft.seo_title} />
        <Row label="Meta description" value={draft.meta_description} />
        <Row label="Keywords" value={<Chips items={draft.keywords} />} />
        <Row label="Content rating" value={draft.content_rating} />
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="primary" size="sm" onClick={onApply}>
          <Icon name="check" size={14} /> Apply to form
        </Button>
        <span className="text-xs text-muted">
          Fills this tab&apos;s title, synopsis and SEO fields, merges tags{isCreate ? ", sets the slug" : ""}, and selects categories matching the genres.
        </span>
      </div>
    </section>
  );
}

function Row({
  label,
  value,
  wide,
  muted,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  wide?: boolean;
  muted?: boolean;
  hint?: string;
}) {
  return (
    <div className={wide ? "md:col-span-2" : undefined}>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        {label}
        {hint && <span className="ml-1 font-normal normal-case">({hint})</span>}
      </dt>
      <dd className={`mt-0.5 ${muted ? "text-muted" : "text-ink"}`}>{value || <span className="text-muted">—</span>}</dd>
    </div>
  );
}

function Chips({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-muted">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((x) => (
        <span key={x} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-2">
          {x}
        </span>
      ))}
    </span>
  );
}
