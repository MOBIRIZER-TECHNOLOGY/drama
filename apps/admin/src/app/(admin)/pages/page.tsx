"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
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
  TabPanel,
  Table,
  Tabs,
  Td,
  Textarea,
  Th,
  Toggle,
} from "@/components/ui";

type Page = Schemas["AdminCmsPageOut"];
type PageIn = Schemas["CmsPageIn"];

export default function PagesPage() {
  const toast = useToast();
  const { data, loading, error, refetch, setData } = useQuery("pages", () => call(api.GET("/v1/admin/pages")));
  const languages = useQuery("languages", () => call(api.GET("/v1/admin/languages")));
  const [editing, setEditing] = useState<Page | "new" | null>(null);
  const [deleting, setDeleting] = useState<Page | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    const victim = deleting;
    try {
      await call(api.DELETE("/v1/admin/pages/{page_id}", { params: { path: { page_id: victim.id } } }));
      setData((prev) => (prev ?? []).filter((p) => p.id !== victim.id));
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
        {error && !data ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : !data ? (
          <LoadingState />
        ) : data.length === 0 ? (
          <EmptyState title="No pages" description="Create Terms of Service and Privacy Policy first." />
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
              {data.map((p) => (
                <tr key={p.id} className={`hover:bg-surface-2/50 ${loading ? "opacity-70" : ""}`}>
                  <Td className="font-mono text-xs">/{p.slug}</Td>
                  <Td className="font-medium">{p.translations.find((t) => t.lang === "en")?.title ?? p.translations[0]?.title ?? "—"}</Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      {p.translations.map((t) => (
                        <Badge key={t.lang}>{t.lang}</Badge>
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
                      <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
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
      </Card>

      {editing && (
        <PageDialog
          page={editing === "new" ? null : editing}
          langCodes={langCodes}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setData((prev) => {
              const list = prev ?? [];
              return list.some((p) => p.id === saved.id) ? list.map((p) => (p.id === saved.id ? saved : p)) : [...list, saved];
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
