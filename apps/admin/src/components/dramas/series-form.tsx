"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { type MetadataDraft } from "@/lib/ai";
import { api, call, type Schemas } from "@/lib/api";
import { fromLocalInput, slugify, toLocalInput } from "@/lib/format";
import { useFieldErrors } from "@/lib/forms";
import { CONTENT_RATINGS } from "@/lib/ratings";
import { useQuery } from "@/lib/use-query";
import { AiMetadataPanel } from "@/components/dramas/ai-metadata-panel";
import { ImageUpload } from "@/components/image-upload";
import { useToast } from "@/components/toast";
import { useSaveShortcut, useUnsavedChanges } from "@/lib/editing";
import { Badge, Button, Card, ChipInput, Field, Input, LoadingState, Select, TabPanel, Tabs, Textarea, Toggle } from "@/components/ui";

type SeriesIn = Schemas["SeriesIn"];
type SeriesOut = Schemas["AdminSeriesOut"];
type TranslationIn = Schemas["SeriesTranslationIn"];
type PublishStatus = Schemas["PublishStatus"];

export const PUBLISH_STATUSES: PublishStatus[] = ["draft", "review", "published", "archived"];

type TranslationDraft = {
  title: string;
  synopsis: string;
  seo_title: string;
  meta_description: string;
  keywords: string[];
};

type FormState = {
  slug: string;
  cover_url: string | null;
  banner_url: string | null;
  original_language: string;
  free_episodes: number;
  episode_price: string;
  is_featured: boolean;
  is_premium: boolean;
  status: PublishStatus;
  released_at: string;
  content_rating: string;
  sort_weight: number;
  visible_languages: string[] | null;
  territories: string;
  window_starts_at: string;
  window_ends_at: string;
  moderation_flags: string[];
  moderation_note: string;
  category_ids: string[];
  tags: string[];
  translations: Record<string, TranslationDraft>;
};

type ErrorKey = "title" | "slug" | "free_episodes" | "episode_price" | "territories" | "window";

const emptyTranslation = (): TranslationDraft => ({
  title: "",
  synopsis: "",
  seo_title: "",
  meta_description: "",
  keywords: [],
});

function fromSeries(s?: SeriesOut): FormState {
  const translations: Record<string, TranslationDraft> = {};
  for (const t of s?.translations ?? []) {
    translations[t.lang] = {
      title: t.title,
      synopsis: t.synopsis ?? "",
      seo_title: t.seo_title ?? "",
      meta_description: t.meta_description ?? "",
      keywords: t.keywords ?? [],
    };
  }
  return {
    slug: s?.slug ?? "",
    cover_url: s?.cover_url ?? null,
    banner_url: s?.banner_url ?? null,
    original_language: s?.original_language ?? "hi",
    free_episodes: s?.free_episodes ?? 5,
    episode_price: s?.episode_price == null ? "" : String(s.episode_price),
    is_featured: s?.is_featured ?? false,
    is_premium: s?.is_premium ?? false,
    status: s?.status ?? "draft",
    released_at: toLocalInput(s?.released_at),
    content_rating: s?.content_rating ?? "",
    sort_weight: s?.sort_weight ?? 0,
    visible_languages: s?.visible_languages ?? null,
    territories: (s?.territories ?? []).join(", "),
    window_starts_at: toLocalInput(s?.window_starts_at),
    window_ends_at: toLocalInput(s?.window_ends_at),
    moderation_flags: s?.moderation_flags ?? [],
    moderation_note: s?.moderation_note ?? "",
    category_ids: s?.category_ids ?? [],
    tags: s?.tags ?? [],
    translations,
  };
}

/** "IN, us , GB" -> ["IN","US","GB"]; empty means "every country" (null on the wire). */
function parseTerritories(input: string): string[] | null {
  const codes = [...new Set(input.split(/[,\s]+/).map((c) => c.trim().toUpperCase()).filter(Boolean))];
  return codes.length ? codes : null;
}

function toPayload(f: FormState): SeriesIn {
  const translations: TranslationIn[] = Object.entries(f.translations)
    .filter(([, t]) => t.title.trim().length > 0)
    .map(([lang, t]) => ({
      lang,
      title: t.title.trim(),
      synopsis: t.synopsis.trim() || null,
      seo_title: t.seo_title.trim() || null,
      meta_description: t.meta_description.trim() || null,
      keywords: t.keywords.length ? t.keywords : null,
    }));
  return {
    slug: f.slug.trim() || null,
    cover_url: f.cover_url || null,
    banner_url: f.banner_url || null,
    original_language: f.original_language,
    free_episodes: f.free_episodes,
    episode_price: f.episode_price === "" ? null : Number(f.episode_price),
    is_featured: f.is_featured,
    is_premium: f.is_premium,
    status: f.status,
    released_at: fromLocalInput(f.released_at),
    content_rating: f.content_rating.trim() || null,
    sort_weight: f.sort_weight,
    visible_languages: f.visible_languages && f.visible_languages.length ? f.visible_languages : null,
    territories: parseTerritories(f.territories),
    window_starts_at: fromLocalInput(f.window_starts_at),
    window_ends_at: fromLocalInput(f.window_ends_at),
    moderation_flags: f.moderation_flags.length ? f.moderation_flags : null,
    moderation_note: f.moderation_note.trim() || null,
    category_ids: f.category_ids,
    tags: f.tags,
    translations,
  };
}

/** Snapshot of everything an AI draft touches, so "Undo" can put it back. */
type ApplySnapshot = Pick<FormState, "slug" | "content_rating" | "tags" | "category_ids"> & { lang: string; translation: TranslationDraft };

export function SeriesForm({
  initial,
  onSaved,
  onDirtyChange,
}: {
  initial?: SeriesOut;
  onSaved: (saved: SeriesOut) => void;
  /** Reports whether the form differs from what was loaded/last saved. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const toast = useToast();
  const tabsId = useId();
  const [form, setForm] = useState<FormState>(() => fromSeries(initial));
  const [baseline, setBaseline] = useState(() => JSON.stringify(fromSeries(initial)));
  const [lang, setLang] = useState<string>(initial?.original_language ?? "hi");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { errors, setErrors, clearError, formRef } = useFieldErrors<ErrorKey>();
  const undoRef = useRef<ApplySnapshot | null>(null);

  const languages = useQuery("languages", () => call(api.GET("/v1/admin/languages")));
  const categories = useQuery("categories", () => call(api.GET("/v1/admin/categories")));

  const dirty = JSON.stringify(form) !== baseline;
  // Ten minutes of typing used to be discarded by a tab close, a sidebar link, or the 8-hour token expiring.
  useUnsavedChanges(dirty && !saving);
  // An editor saves this form dozens of times a day; the browser's own Save Page dialog is never what they want.
  useSaveShortcut(() => formRef.current?.requestSubmit(), dirty && !saving);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const langCodes = useMemo(() => {
    const active = (languages.data ?? []).filter((l) => l.is_active).map((l) => l.code);
    const set = new Set<string>([form.original_language, ...active, ...Object.keys(form.translations)]);
    return [...set];
  }, [languages.data, form.original_language, form.translations]);

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));
  const patchTranslation = (code: string, p: Partial<TranslationDraft>) =>
    setForm((f) => ({
      ...f,
      translations: { ...f.translations, [code]: { ...(f.translations[code] ?? emptyTranslation()), ...p } },
    }));

  const current = form.translations[lang] ?? emptyTranslation();

  function validate(): boolean {
    const next: Partial<Record<ErrorKey, string>> = {};
    const anyTitle = Object.values(form.translations).some((t) => t.title.trim());
    if (!anyTitle) next.title = "Add a title in at least one language.";
    if (form.slug && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug.trim())) {
      next.slug = "Use lowercase letters, digits and single hyphens.";
    }
    if (!Number.isInteger(form.free_episodes) || form.free_episodes < 0) next.free_episodes = "Must be 0 or more.";
    if (form.episode_price !== "" && (!Number.isInteger(Number(form.episode_price)) || Number(form.episode_price) < 0)) {
      next.episode_price = "Must be a whole number of coins (or blank).";
    }
    const badTerritory = (parseTerritories(form.territories) ?? []).find((c) => !/^[A-Z]{2}$/.test(c));
    if (badTerritory) next.territories = `“${badTerritory}” is not a 2-letter ISO country code.`;
    const winStart = fromLocalInput(form.window_starts_at);
    const winEnd = fromLocalInput(form.window_ends_at);
    if (winStart && winEnd && new Date(winStart) >= new Date(winEnd)) next.window = "The window must end after it starts.";
    if (next.title) setLang(form.original_language);
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!validate()) return;
    const payload = toPayload(form);
    setSaving(true);
    try {
      const saved = initial
        ? await call(api.PUT("/v1/admin/series/{series_id}", { params: { path: { series_id: initial.id } }, body: payload }))
        : await call(api.POST("/v1/admin/series", { body: payload }));
      setBaseline(JSON.stringify(form));
      toast.success(initial ? "Series saved" : "Series created");
      onSaved(saved);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  const langLabel = (code: string) => {
    const l = languages.data?.find((x) => x.code === code);
    return l ? `${l.name}` : code;
  };

  /** Apply an AI draft to the active language tab (+ tags, categories, rating, slug when creating), with Undo. */
  function applyDraft(draft: MetadataDraft) {
    const genreNames = new Set(draft.genres.map((g) => g.trim().toLowerCase()));
    const matched = (categories.data ?? [])
      .filter((c) => genreNames.has(c.name.trim().toLowerCase()) || genreNames.has(c.slug.toLowerCase()))
      .map((c) => c.id);
    const targetLang = lang;
    undoRef.current = {
      lang: targetLang,
      translation: form.translations[targetLang] ?? emptyTranslation(),
      slug: form.slug,
      content_rating: form.content_rating,
      tags: form.tags,
      category_ids: form.category_ids,
    };
    setForm((f) => ({
      ...f,
      slug: !initial && draft.slug ? slugify(draft.slug) : f.slug,
      content_rating: draft.content_rating || f.content_rating,
      tags: [...new Set([...f.tags, ...draft.tags.map((t) => t.trim()).filter(Boolean)])],
      category_ids: [...new Set([...f.category_ids, ...matched])],
      translations: {
        ...f.translations,
        [targetLang]: {
          title: draft.title,
          synopsis: draft.synopsis,
          seo_title: draft.seo_title.slice(0, 70),
          meta_description: draft.meta_description.slice(0, 200),
          keywords: draft.keywords,
        },
      },
    }));
    toast.success(`Draft applied to ${langLabel(targetLang)}; review before saving.`, {
      action: {
        label: "Undo",
        onClick: () => {
          const snap = undoRef.current;
          if (!snap) return;
          setForm((f) => ({
            ...f,
            slug: snap.slug,
            content_rating: snap.content_rating,
            tags: snap.tags,
            category_ids: snap.category_ids,
            translations: { ...f.translations, [snap.lang]: snap.translation },
          }));
          undoRef.current = null;
          setLang(snap.lang);
        },
      },
    });
  }

  return (
    <form ref={formRef} onSubmit={submit} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]" noValidate>
      <div className="flex flex-col gap-6">
        <AiMetadataPanel
          languageOptions={langCodes.map(langLabel)}
          currentLanguage={langLabel(lang)}
          existingTitle={current.title}
          existingSynopsis={current.synopsis}
          isCreate={!initial}
          seriesId={initial?.id}
          onApply={applyDraft}
        />

        <Card title="Titles & synopsis">
          <div className="px-5 pt-3">
            {languages.loading && !languages.data ? (
              <LoadingState label="Loading languages…" />
            ) : (
              <Tabs
                id={tabsId}
                label="Translation language"
                value={lang}
                onChange={setLang}
                tabs={langCodes.map((code) => ({
                  value: code,
                  label: langLabel(code),
                  badge:
                    code === form.original_language ? (
                      <Badge tone="accent">original</Badge>
                    ) : form.translations[code]?.title?.trim() ? (
                      <span aria-label="has translation" className="h-1.5 w-1.5 rounded-full bg-success" />
                    ) : null,
                }))}
              />
            )}
          </div>
          <TabPanel tabsId={tabsId} value={lang} className="grid gap-4 px-5 py-4">
            <Field label="Title" required={lang === form.original_language} error={lang === form.original_language ? errors.title : undefined}>
              <Input
                value={current.title}
                maxLength={200}
                onChange={(e) => {
                  patchTranslation(lang, { title: e.target.value });
                  clearError("title");
                }}
                onBlur={() => {
                  if (!initial && lang === form.original_language && !form.slug && current.title) {
                    patch({ slug: slugify(current.title) });
                  }
                }}
              />
            </Field>
            <Field label="Synopsis">
              <Textarea value={current.synopsis} onChange={(e) => patchTranslation(lang, { synopsis: e.target.value })} />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="SEO title" hint={`${current.seo_title.length}/70`}>
                <Input value={current.seo_title} maxLength={70} onChange={(e) => patchTranslation(lang, { seo_title: e.target.value })} />
              </Field>
              <Field label="Meta description" hint={`${current.meta_description.length}/200`}>
                <Input
                  value={current.meta_description}
                  maxLength={200}
                  onChange={(e) => patchTranslation(lang, { meta_description: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Keywords">
              <ChipInput label="Keywords" values={current.keywords} onChange={(v) => patchTranslation(lang, { keywords: v })} />
            </Field>
          </TabPanel>
        </Card>

        <Card title="Artwork">
          <div className="grid gap-6 px-5 py-4 md:grid-cols-2">
            <ImageUpload label="Cover (9:16)" value={form.cover_url} onChange={(v) => patch({ cover_url: v })} aspect="portrait" />
            <ImageUpload label="Banner (16:9)" value={form.banner_url} onChange={(v) => patch({ banner_url: v })} aspect="wide" />
          </div>
        </Card>

        <Card title="Catalogue">
          <div className="grid gap-4 px-5 py-4 md:grid-cols-2">
            <Field label="Slug" hint="Lowercase, hyphenated. Leave blank to derive from the title." error={errors.slug}>
              <Input
                value={form.slug}
                maxLength={160}
                onChange={(e) => {
                  patch({ slug: e.target.value });
                  clearError("slug");
                }}
              />
            </Field>
            <Field label="Original language">
              <Select value={form.original_language} onChange={(e) => patch({ original_language: e.target.value })}>
                {langCodes.map((c) => (
                  <option key={c} value={c}>
                    {langLabel(c)} ({c})
                  </option>
                ))}
              </Select>
            </Field>
            <fieldset className="md:col-span-2">
              <legend className="mb-1.5 block text-[13px] font-medium text-ink-2">Categories</legend>
              {categories.error ? (
                <p className="text-xs text-danger">{categories.error}</p>
              ) : !categories.data ? (
                <p className="text-xs text-muted">Loading…</p>
              ) : categories.data.length === 0 ? (
                <p className="text-xs text-muted">No categories yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {categories.data.map((c) => {
                    const on = form.category_ids.includes(c.id);
                    return (
                      <label
                        key={c.id}
                        className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                          on ? "border-accent bg-accent/10 text-accent" : "border-line-strong text-ink-2"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={on}
                          onChange={(e) =>
                            patch({
                              category_ids: e.target.checked ? [...form.category_ids, c.id] : form.category_ids.filter((x) => x !== c.id),
                            })
                          }
                        />
                        {c.name}
                      </label>
                    );
                  })}
                </div>
              )}
            </fieldset>
            <Field label="Tags" className="md:col-span-2">
              <ChipInput label="Tags" values={form.tags} onChange={(v) => patch({ tags: v })} />
            </Field>
            <Field label="Content rating" hint="A and UA16 require age confirmation before playback.">
              <Select value={form.content_rating} onChange={(e) => patch({ content_rating: e.target.value })}>
                <option value="">Unrated</option>
                {CONTENT_RATINGS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.value} · {r.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Sort weight" hint="Higher shows first in rails.">
              <Input type="number" value={form.sort_weight} onChange={(e) => patch({ sort_weight: Number(e.target.value) || 0 })} />
            </Field>
          </div>
        </Card>

        <Card title="Distribution">
          <div className="grid gap-4 px-5 py-4 md:grid-cols-2">
            <fieldset className="md:col-span-2">
              <legend className="mb-1.5 block text-[13px] font-medium text-ink-2">Visible languages</legend>
              <p className="mb-2 text-xs text-muted">
                Which UI languages show this series in the catalogue. Leave <em>every language</em> on unless the series is region-locked.
              </p>
              <label className="mb-2 inline-flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="accent-[var(--accent)]"
                  checked={form.visible_languages == null}
                  onChange={(e) => patch({ visible_languages: e.target.checked ? null : langCodes.slice(0, 1) })}
                />
                Every language
              </label>
              {form.visible_languages != null && (
                <div className="flex flex-wrap gap-2">
                  {langCodes.map((code) => {
                    const on = form.visible_languages?.includes(code) ?? false;
                    return (
                      <label
                        key={code}
                        className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                          on ? "border-accent bg-accent/10 text-accent" : "border-line-strong text-ink-2"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={on}
                          onChange={(e) =>
                            patch({
                              visible_languages: e.target.checked
                                ? [...(form.visible_languages ?? []), code]
                                : (form.visible_languages ?? []).filter((x) => x !== code),
                            })
                          }
                        />
                        {langLabel(code)} ({code})
                      </label>
                    );
                  })}
                </div>
              )}
              {form.visible_languages != null && form.visible_languages.length === 0 && (
                <p className="mt-2 text-xs text-warning">No languages selected: the series will be hidden everywhere.</p>
              )}
            </fieldset>

            <Field
              label="Territories"
              className="md:col-span-2"
              hint="Comma-separated ISO country codes, e.g. IN, NP, LK. Blank means every country."
              error={errors.territories}
            >
              <Input
                value={form.territories}
                placeholder="IN, NP, LK"
                onChange={(e) => {
                  patch({ territories: e.target.value });
                  clearError("territories");
                }}
                className="font-mono uppercase"
              />
            </Field>

            <Field label="Window starts at" hint="Blank is available immediately.">
              <Input
                type="datetime-local"
                value={form.window_starts_at}
                onChange={(e) => {
                  patch({ window_starts_at: e.target.value });
                  clearError("window");
                }}
              />
            </Field>
            <Field label="Window ends at" hint="Blank never expires." error={errors.window}>
              <Input
                type="datetime-local"
                value={form.window_ends_at}
                onChange={(e) => {
                  patch({ window_ends_at: e.target.value });
                  clearError("window");
                }}
              />
            </Field>
          </div>
        </Card>

        <Card
          title="Moderation"
          actions={
            form.moderation_flags.length > 0 ? (
              <Button size="sm" onClick={() => patch({ moderation_flags: [] })}>
                Clear all flags
              </Button>
            ) : undefined
          }
        >
          <div className="grid gap-4 px-5 py-4">
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-ink-2">Flags</p>
              {form.moderation_flags.length === 0 ? (
                <p className="text-xs text-muted">No flags. The metadata AI raises these; clearing them saves with the series.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {form.moderation_flags.map((flag) => (
                    <span key={flag} className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">
                      {flag}
                      <button
                        type="button"
                        aria-label={`Clear flag ${flag}`}
                        onClick={() => patch({ moderation_flags: form.moderation_flags.filter((f) => f !== flag) })}
                        className="text-danger/70 hover:text-danger"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <Field label="Moderation note" hint="Why this series was flagged, or what a reviewer decided.">
              <Textarea value={form.moderation_note} onChange={(e) => patch({ moderation_note: e.target.value })} className="min-h-16" />
            </Field>
          </div>
        </Card>
      </div>

      <aside className="flex flex-col gap-6">
        <Card title="Publishing">
          <div className="grid gap-4 px-5 py-4">
            <Field label="Status">
              <Select value={form.status} onChange={(e) => patch({ status: e.target.value as PublishStatus })}>
                {PUBLISH_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Released at">
              <Input type="datetime-local" value={form.released_at} onChange={(e) => patch({ released_at: e.target.value })} />
            </Field>
            <Toggle label="Featured" description="Pinned in the home hero rail." checked={form.is_featured} onChange={(v) => patch({ is_featured: v })} />
            <Toggle label="Premium" description="VIP-only series." checked={form.is_premium} onChange={(v) => patch({ is_premium: v })} />
          </div>
        </Card>

        <Card title="Pricing">
          <div className="grid gap-4 px-5 py-4">
            <Field label="Free episodes" hint="Episodes 1–N are free for everyone." error={errors.free_episodes}>
              <Input
                type="number"
                min={0}
                value={form.free_episodes}
                onChange={(e) => {
                  patch({ free_episodes: Math.max(0, Number(e.target.value) || 0) });
                  clearError("free_episodes");
                }}
              />
            </Field>
            <Field label="Episode price (coins)" hint="Blank uses the global default from Settings › economy." error={errors.episode_price}>
              <Input
                type="number"
                min={0}
                value={form.episode_price}
                placeholder="default"
                onChange={(e) => {
                  patch({ episode_price: e.target.value });
                  clearError("episode_price");
                }}
              />
            </Field>
          </div>
        </Card>

        {error && (
          <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="sticky bottom-4 flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
          <Button type="submit" variant="primary" loading={saving}>
            {initial ? "Save changes" : "Create series"}
          </Button>
          {initial && dirty && <p className="text-xs text-muted">Unsaved changes · ⌘/Ctrl+S</p>}
          {!initial && <p className="text-xs text-muted">Episodes can be added after the series is created.</p>}
        </div>
      </aside>
    </form>
  );
}
