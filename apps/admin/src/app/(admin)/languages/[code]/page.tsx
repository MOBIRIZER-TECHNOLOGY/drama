"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { memo, useCallback, useMemo, useState } from "react";
import { api, call } from "@/lib/api";
import { downloadCsv, parseCsv, useUnsavedChanges } from "@/lib/editing";
import { checkPlaceholders, describeProblem, tooLong, type PlaceholderProblem } from "@/lib/placeholders";
import { useQuery } from "@/lib/use-query";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  InlineError,
  Input,
  LoadingState,
  PageHeader,
  SearchInput,
  Select,
  Table,
  Td,
  Th,
} from "@/components/ui";

type TargetEntry = { value: string; source: string };
type TranslationsOut = {
  lang: string;
  source: Record<string, string>;
  target: Record<string, TargetEntry>;
  missing: string[];
};

type Filter = "all" | "missing" | "ai" | "human";
const WINDOW = 200;

export default function TranslationsPage() {
  const { code } = useParams<{ code: string }>();
  const toast = useToast();
  const { data, loading, error, refetch, setData } = useQuery(`translations:${code}`, async () => {
    const raw = await call(api.GET("/v1/admin/translations/{lang}", { params: { path: { lang: code } } }));
    return raw as unknown as TranslationsOut;
  });
  const languages = useQuery("languages", () => call(api.GET("/v1/admin/languages")));
  const language = languages.data?.find((l) => l.code === code);
  const rtl = Boolean(language?.is_rtl);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(WINDOW);
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiInfo, setAiInfo] = useState<string | null>(null);

  const isSource = code === "en";

  const keys = useMemo(() => {
    if (!data) return [];
    const all = Object.keys(data.source).sort();
    const needle = q.trim().toLowerCase();
    return all.filter((k) => {
      const t = data.target[k];
      if (filter === "missing" && t) return false;
      if (filter === "ai" && t?.source !== "ai") return false;
      if (filter === "human" && t?.source !== "human") return false;
      if (!needle) return true;
      return k.toLowerCase().includes(needle) || data.source[k].toLowerCase().includes(needle) || (t?.value ?? "").toLowerCase().includes(needle);
    });
  }, [data, filter, q]);
  const visible = keys.slice(0, shown);

  const dirty = useMemo(() => {
    if (!data) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(drafts)) {
      const current = data.target[k]?.value ?? "";
      if (v !== current) out[k] = v;
    }
    return out;
  }, [drafts, data]);
  const dirtyCount = Object.keys(dirty).length;
  // A translator can have a hundred edited strings in flight here; losing them to a stray click is a day's work.
  useUnsavedChanges(dirtyCount > 0, "You have unsaved translations. Leave without saving?");

  // Stable handler so memoised rows only re-render when their own value changes.
  const onRowChange = useCallback((key: string, value: string) => {
    setDrafts((d) => ({ ...d, [key]: value }));
  }, []);

  async function save() {
    if (!data || dirtyCount === 0) return;
    const messages: Record<string, string> = {};
    for (const [k, v] of Object.entries(dirty)) if (v.trim()) messages[k] = v;
    if (Object.keys(messages).length === 0) {
      toast.error("Nothing to save: empty values are ignored");
      return;
    }

    // Refuse the whole save rather than shipping a string that will render braces to a viewer.
    const broken = Object.entries(messages)
      .map(([k, v]) => [k, checkPlaceholders(data.source[k] ?? "", v)] as const)
      .filter((entry): entry is [string, PlaceholderProblem] => entry[1] !== null);
    if (broken.length) {
      toast.error(
        `${broken.length} string${broken.length === 1 ? "" : "s"} would break: ${broken
          .slice(0, 3)
          .map(([k, problem]) => `${k} (${describeProblem(problem)})`)
          .join(", ")}`,
      );
      return;
    }
    setSaving(true);
    try {
      await call(api.PUT("/v1/admin/translations/{lang}", { params: { path: { lang: code } }, body: { messages, source: "human" } }));
      setData((prev) => {
        if (!prev) return prev!;
        const target = { ...prev.target };
        for (const [k, v] of Object.entries(messages)) target[k] = { value: v, source: "human" };
        return { ...prev, target, missing: prev.missing.filter((k) => !(k in target)) };
      });
      setDrafts({});
      toast.success(`Saved ${Object.keys(messages).length} strings`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  /** Export every key with its source and current translation, for a vendor or a spreadsheet. */
  function exportCsv() {
    if (!data) return;
    downloadCsv(
      `katha-translations-${code}`,
      [
        { key: "key", label: "Key" },
        { key: "source", label: "English" },
        { key: "translation", label: code },
        { key: "state", label: "State" },
      ],
      Object.keys(data.source)
        .sort()
        .map((k) => ({
          key: k,
          source: data.source[k],
          translation: drafts[k] ?? data.target[k]?.value ?? "",
          state: data.target[k]?.source ?? "missing",
        })),
    );
  }

  /**
   * Import a returned CSV as drafts rather than writing straight through.
   *
   * Nothing is saved until the operator reviews and presses Save, so a vendor file with a broken placeholder is
   * caught by the same check as hand editing, and an unexpected column layout is visible before it lands.
   */
  async function importCsv(file: File) {
    if (!data) return;
    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length === 0) {
      toast.error("That file has no rows");
      return;
    }
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const keyAt = header.indexOf("key");
    // The translation column is named after the language, and falls back to the third column.
    const valueAt = header.indexOf(code.toLowerCase()) >= 0 ? header.indexOf(code.toLowerCase()) : 2;
    if (keyAt < 0 || valueAt < 0) {
      toast.error('Expected a "key" column and a column named after the language');
      return;
    }

    const next: Record<string, string> = {};
    let unknown = 0;
    for (const row of rows.slice(1)) {
      const k = (row[keyAt] ?? "").trim();
      const v = (row[valueAt] ?? "").trim();
      if (!k || !v) continue;
      if (!(k in data.source)) {
        unknown += 1;
        continue;
      }
      if (v !== (data.target[k]?.value ?? "")) next[k] = v;
    }
    setDrafts((d) => ({ ...d, ...next }));
    const count = Object.keys(next).length;
    toast.success(
      count === 0
        ? "Nothing new in that file"
        : `${count} string${count === 1 ? "" : "s"} loaded as drafts${unknown ? `, ${unknown} unknown key${unknown === 1 ? "" : "s"} skipped` : ""}. Review, then Save.`,
    );
  }

  async function aiTranslate() {
    setAiBusy(true);
    setAiInfo(null);
    try {
      const res = (await call(api.POST("/v1/admin/translations/{lang}/ai", { params: { path: { lang: code } }, body: { keys: null } }))) as {
        queued?: number;
        job_id?: string;
      };
      const n = res.queued ?? 0;
      setAiInfo(n === 0 ? "Nothing to translate: no missing keys." : `Queued ${n} keys for AI translation${res.job_id ? ` (job ${res.job_id})` : ""}. Refresh in a minute.`);
      toast.success(n === 0 ? "No missing keys" : `Queued ${n} keys`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not queue translation");
    } finally {
      setAiBusy(false);
    }
  }

  const stats = data
    ? { total: Object.keys(data.source).length, missing: data.missing.length, ai: Object.values(data.target).filter((t) => t.source === "ai").length }
    : null;

  return (
    <>
      <PageHeader
        title={`Translations · ${language?.name ?? code}`}
        description={
          isSource
            ? "English is the source language. Edit source strings here; other languages translate from them."
            : stats
              ? `${stats.total - stats.missing}/${stats.total} translated · ${stats.missing} missing · ${stats.ai} by AI${rtl ? " · right-to-left" : ""}`
              : undefined
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/languages" className="mr-2 text-sm text-muted hover:text-ink">
              ← Languages
            </Link>
            <Button onClick={exportCsv} disabled={!data}>
              Export CSV
            </Button>
            {!isSource && (
              <>
                {/* A vendor returns the file we exported; it lands as drafts so the placeholder check still runs. */}
                <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-2">
                  Import CSV
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (file) void importCsv(file);
                    }}
                  />
                </label>
                <Button onClick={aiTranslate} loading={aiBusy} disabled={!data || data.missing.length === 0}>
                  <Icon name="globe" size={15} /> AI translate missing
                </Button>
              </>
            )}
            <Button variant="primary" onClick={save} loading={saving} disabled={dirtyCount === 0}>
              Save {dirtyCount > 0 ? `(${dirtyCount})` : ""}
            </Button>
          </div>
        }
      />

      {aiInfo && (
        <p role="status" className="mb-4 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-ink-2">
          {aiInfo}{" "}
          <button type="button" onClick={refetch} className="text-accent underline">
            Refresh now
          </button>
        </p>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v);
              setShown(WINDOW);
            }}
            placeholder="Search keys or text…"
          />
          {!isSource && (
            <Select
              aria-label="Filter"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value as Filter);
                setShown(WINDOW);
              }}
              className="w-40"
            >
              <option value="all">All keys</option>
              <option value="missing">Missing only</option>
              <option value="ai">AI translated</option>
              <option value="human">Human translated</option>
            </Select>
          )}
          <span className="text-xs text-muted">
            {keys.length} {keys.length === 1 ? "key" : "keys"}
            {loading && data ? " · refreshing…" : ""}
          </span>
        </div>

        {error && data && <InlineError message={error} onRetry={refetch} />}
        {error && !data ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : !data ? (
          <LoadingState />
        ) : keys.length === 0 ? (
          <EmptyState
            title={Object.keys(data.source).length === 0 ? "No source strings" : "No keys match"}
            description={Object.keys(data.source).length === 0 ? "Seed English UI strings first." : undefined}
          />
        ) : (
          <>
            <Table minWidth={760}>
              <thead>
                <tr>
                  <Th className="w-1/4">Key</Th>
                  <Th className="w-1/3">{isSource ? "Current" : "English"}</Th>
                  <Th>{isSource ? "New value" : "Translation"}</Th>
                  <Th className="w-24">Source</Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((k) => {
                  const t = data.target[k];
                  return (
                    <TranslationRow
                      key={k}
                      k={k}
                      source={data.source[k]}
                      value={drafts[k] ?? t?.value ?? ""}
                      targetSource={t?.source ?? null}
                      changed={k in dirty}
                      rtl={rtl && !isSource}
                      onChange={onRowChange}
                    />
                  );
                })}
              </tbody>
            </Table>
            {keys.length > visible.length && (
              <div className="flex items-center justify-between px-4 py-3 text-sm text-muted">
                <span>
                  Showing {visible.length} of {keys.length}
                </span>
                <Button size="sm" onClick={() => setShown((s) => s + WINDOW)}>
                  Load {Math.min(WINDOW, keys.length - visible.length)} more
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </>
  );
}

const TranslationRow = memo(function TranslationRow({
  k,
  source,
  value,
  targetSource,
  changed,
  rtl,
  onChange,
}: {
  k: string;
  source: string;
  value: string;
  targetSource: string | null;
  changed: boolean;
  rtl: boolean;
  onChange: (key: string, value: string) => void;
}) {
  const missing = targetSource == null;
  const problem = checkPlaceholders(source, value);
  const long = !problem && tooLong(source, value);
  return (
    <tr className={changed ? "bg-accent/5" : undefined}>
      <Td className="align-top font-mono text-xs text-ink-2">{k}</Td>
      <Td className="align-top text-sm text-ink-2">{source}</Td>
      <Td className="align-top">
        <Input
          aria-label={`Translation for ${k}`}
          value={value}
          placeholder={missing ? "missing" : ""}
          dir={rtl ? "rtl" : undefined}
          onChange={(e) => onChange(k, e.target.value)}
          aria-invalid={problem ? true : undefined}
          className={`h-9 ${problem ? "border-danger" : missing && !value ? "border-warning/60" : ""}`}
        />
        {/* A dropped {count} renders the literal brace text to a viewer, and nothing used to catch it. */}
        {problem ? (
          <p role="alert" className="mt-1 text-[11px] text-danger">
            Placeholders: {describeProblem(problem)}
          </p>
        ) : long ? (
          <p className="mt-1 text-[11px] text-warning">Much longer than the source — check it still fits.</p>
        ) : null}
      </Td>
      <Td className="align-top">
        {changed ? (
          <Badge tone="accent">edited</Badge>
        ) : missing ? (
          <Badge tone="warning">missing</Badge>
        ) : targetSource === "ai" ? (
          <Badge tone="gold">ai</Badge>
        ) : (
          <Badge tone="success">{targetSource}</Badge>
        )}
      </Td>
    </tr>
  );
});
