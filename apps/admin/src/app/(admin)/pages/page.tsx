"use client";

import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { api, call, type Schemas } from "@/lib/api";
import { slugify } from "@/lib/format";
import { useFieldErrors } from "@/lib/forms";
import { useQuery } from "@/lib/use-query";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  TabPanel,
  Table,
  Tabs,
  Td,
  Textarea,
  Th,
  Toggle,
} from "@/components/ui";

type Page = Schemas["AdminCmsPageOut"];
type PageSummary = Schemas["AdminCmsPageSummary"];
type PageIn = Schemas["CmsPageIn"];
const LIMIT = 25;

export default function PagesPage() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data, loading, error, refetch, setData } = useQuery(`pages:${debounced}:${offset}`, () =>
    call(api.GET("/v1/admin/pages", { params: { query: { q: debounced || undefined, limit: LIMIT, offset } } })),
  );
  const languages = useQuery("languages", () => call(api.GET("/v1/admin/languages")));
  /**
   * The list carries no bodies, so opening a row fetches the page itself. That is the whole point of the
   * split: rendering a table of slugs used to download every translation of every page.
   */
  const [editing, setEditing] = useState<Page | "new" | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<PageSummary | null>(null);
  const [busy, setBusy] = useState(false);

  async function open(row: PageSummary) {
    setOpening(row.id);
    try {
      setEditing(await call(api.GET("/v1/admin/pages/{page_id}", { params: { path: { page_id: row.id } } })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open that page");
    } finally {
      setOpening(null);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    const victim = deleting;
    try {
      await call(api.DELETE("/v1/admin/pages/{page_id}", { params: { path: { page_id: victim.id } } }));
      setData((prev) =>
        prev ? { items: prev.items.filter((p) => p.id !== victim.id), total: Math.max(0, prev.total - 1) } : prev!,
      );
      toast.success(`Deleted /${victim.slug}`);
      setDeleting(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  const langCodes = useMemo(() => {
    const active = (languages.data ?? []).filter((l) => l.is_active).map((l) => l.code);
    return active.length ? active : ["en"];
  }, [languages.data]);

  return (
    <>
      <PageHeader
        title="Pages"
        description="Static content such as Terms, Privacy and About, per language."
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Icon name="plus" size={15} /> New page
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v);
              setOffset(0);
            }}
            placeholder="Search slug or title…"
          />
          {data && <span className="text-xs text-muted">{data.total} pages</span>}
          {loading && data && <span className="text-xs text-muted">Refreshing…</span>}
        </div>
        {error && !data ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : !data ? (
          <LoadingState />
        ) : data.items.length === 0 ? (
          <EmptyState
            title={debounced ? "No matches" : "No pages"}
            description={debounced ? `Nothing matches “${debounced}”.` : "Create Terms of Service and Privacy Policy first."}
          />
        ) : (
          <Table minWidth={640}>
            <thead>
              <tr>
                <Th>Slug</Th>
                <Th>Title</Th>
                <Th>Languages</Th>
                <Th>Flags</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id} className={`hover:bg-surface-2/50 ${loading ? "opacity-70" : ""}`}>
                  <Td className="font-mono text-xs">/{p.slug}</Td>
                  <Td className="font-medium">{p.title ?? <span className="text-muted">—</span>}</Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      {p.languages.length === 0 ? (
                        <Badge tone="warning">none</Badge>
                      ) : (
                        p.languages.map((code) => <Badge key={code}>{code}</Badge>)
                      )}
                      {/* A published page missing a language renders in English to that audience, and the
                          list is the only place anyone would notice. */}
                      {missing(p, langCodes).map((code) => (
                        <Badge key={`missing-${code}`} tone="warning">
                          {code}?
                        </Badge>
                      ))}
                    </span>
                  </Td>
                  <Td>
                    <span className="flex gap-1">
                      {p.is_published ? <Badge tone="success">published</Badge> : <Badge>draft</Badge>}
                      {p.show_in_footer && <Badge tone="accent">footer</Badge>}
                    </span>
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" loading={opening === p.id} onClick={() => void open(p)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" aria-label={`Delete ${p.slug}`} onClick={() => setDeleting(p)}>
                        <Icon name="trash" size={14} className="text-danger" />
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {data && (data.items.length > 0 || offset > 0) && (
          <Pagination
            offset={offset}
            limit={LIMIT}
            count={data.items.length}
            hasNext={offset + data.items.length < data.total}
            total={data.total}
            onChange={setOffset}
          />
        )}
      </Card>

      {editing && (
        <PageDialog
          page={editing === "new" ? null : editing}
          langCodes={langCodes}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            const row = summarise(saved);
            setData((prev) => {
              if (!prev) return { items: [row], total: 1 };
              const items = prev.items.some((p) => p.id === row.id)
                ? prev.items.map((p) => (p.id === row.id ? row : p))
                : [...prev.items, row];
              return { items, total: prev.items.some((p) => p.id === row.id) ? prev.total : prev.total + 1 };
            });
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={deleting != null}
        title="Delete page"
        message={`Delete /${deleting?.slug ?? ""} in all languages?`}
        loading={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

type Draft = { title: string; body_html: string };

/** Which active languages this page has no translation for. */
function missing(page: PageSummary, active: string[]): string[] {
  return active.filter((code) => !page.languages.includes(code));
}

/** The saved detail collapsed back into a row, so the list updates without a refetch. */
function summarise(saved: Page): PageSummary {
  const byLang = Object.fromEntries(saved.translations.map((t) => [t.lang, t.title]));
  return {
    id: saved.id,
    slug: saved.slug,
    show_in_footer: saved.show_in_footer,
    is_published: saved.is_published,
    languages: Object.keys(byLang).sort(),
    title: byLang.en ?? Object.values(byLang)[0] ?? null,
  };
}

function PageDialog({
  page,
  langCodes,
  onClose,
  onSaved,
}: {
  page: Page | null;
  langCodes: string[];
  onClose: () => void;
  onSaved: (p: Page) => void;
}) {
  const toast = useToast();
  const [slug, setSlug] = useState(page?.slug ?? "");
  const [showInFooter, setShowInFooter] = useState(page?.show_in_footer ?? true);
  const [published, setPublished] = useState(page?.is_published ?? true);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => {
    const out: Record<string, Draft> = {};
    for (const t of page?.translations ?? []) out[t.lang] = { title: t.title, body_html: t.body_html };
    return out;
  });
  const codes = useMemo(() => [...new Set([...langCodes, ...Object.keys(drafts)])], [langCodes, drafts]);
  const [lang, setLang] = useState(codes[0] ?? "en");
  const [saving, setSaving] = useState(false);
  const tabsId = useId();
  const { errors, setErrors, clearError, formRef } = useFieldErrors<"slug" | "title">();

  const current = drafts[lang] ?? { title: "", body_html: "" };
  const patch = (p: Partial<Draft>) => setDrafts((d) => ({ ...d, [lang]: { ...(d[lang] ?? { title: "", body_html: "" }), ...p } }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const translations = Object.entries(drafts)
      .filter(([, t]) => t.title.trim())
      .map(([code, t]) => ({ lang: code, title: t.title.trim(), body_html: t.body_html }));
    const body: PageIn = { slug: (slug || slugify(translations[0]?.title ?? "")).trim(), show_in_footer: showInFooter, is_published: published, translations };
    const next: { slug?: string; title?: string } = {};
    if (!body.slug) next.slug = "Slug is required.";
    else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.slug)) next.slug = "Use lowercase letters, digits and single hyphens.";
    if (translations.length === 0) {
      next.title = "Add a title in at least one language.";
      setLang(codes[0] ?? "en");
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      const saved = page
        ? await call(api.PUT("/v1/admin/pages/{page_id}", { params: { path: { page_id: page.id } }, body }))
        : await call(api.POST("/v1/admin/pages", { body }));
      toast.success(page ? "Page saved" : "Page created");
      onSaved(saved);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={page ? `Edit /${page.slug}` : "New page"}
      width="max-w-3xl"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="page-form" variant="primary" loading={saving}>
            {page ? "Save" : "Create"}
          </Button>
        </>
      }
    >
      <form id="page-form" ref={formRef} onSubmit={submit} className="grid gap-4" noValidate>
        <div className="grid gap-4 md:grid-cols-[1fr_auto_auto] md:items-end">
          <Field label="Slug" required hint="URL path, e.g. terms or privacy." error={errors.slug}>
            <Input
              data-autofocus
              value={slug}
              maxLength={80}
              onChange={(e) => {
                setSlug(e.target.value);
                clearError("slug");
              }}
              className="font-mono"
            />
          </Field>
          <Toggle label="Show in footer" checked={showInFooter} onChange={setShowInFooter} />
          <Toggle label="Published" checked={published} onChange={setPublished} />
        </div>
        <Tabs
          id={tabsId}
          label="Language"
          value={lang}
          onChange={setLang}
          tabs={codes.map((c) => ({
            value: c,
            label: c,
            badge: drafts[c]?.title?.trim() ? <span aria-label="has content" className="h-1.5 w-1.5 rounded-full bg-success" /> : null,
          }))}
        />
        <TabPanel tabsId={tabsId} value={lang} className="grid gap-4">
          <Field label={`Title (${lang})`} required={lang === codes[0]} error={lang === codes[0] ? errors.title : undefined}>
            <Input
              value={current.title}
              maxLength={200}
              onChange={(e) => {
                patch({ title: e.target.value });
                clearError("title");
              }}
            />
          </Field>
          <Field label={`Body HTML (${lang})`} hint="Sanitised by the API on save; scripts and inline handlers are stripped.">
            <Textarea value={current.body_html} onChange={(e) => patch({ body_html: e.target.value })} className="min-h-72 font-mono text-xs" spellCheck={false} />
          </Field>
        </TabPanel>
      </form>
    </Modal>
  );
}
