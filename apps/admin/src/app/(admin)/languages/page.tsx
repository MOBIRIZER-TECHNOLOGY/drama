"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { api, call, type Schemas } from "@/lib/api";
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
  LinkButton,
  LoadingState,
  Modal,
  PageHeader,
  Table,
  Td,
  Th,
  Toggle,
} from "@/components/ui";

type Language = Schemas["AdminLanguageOut"];
type LanguageIn = Schemas["LanguageIn"];

export default function LanguagesPage() {
  const toast = useToast();
  const { data, loading, error, refetch, setData } = useQuery("languages", () => call(api.GET("/v1/admin/languages")));
  const [editing, setEditing] = useState<Language | "new" | null>(null);
  const [deleting, setDeleting] = useState<Language | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    const victim = deleting;
    try {
      await call(api.DELETE("/v1/admin/languages/{code}", { params: { path: { code: victim.code } } }));
      setData((prev) => (prev ?? []).filter((l) => l.code !== victim.code));
      toast.success(`Removed ${victim.name}`);
      setDeleting(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...(data ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code));

  return (
    <>
      <PageHeader
        title="Languages & translations"
        description="Catalogue languages and the UI strings for each. English is the source language."
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Icon name="plus" size={15} /> Add language
          </Button>
        }
      />
      <Card>
        {error && !data ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : !data ? (
          <LoadingState />
        ) : sorted.length === 0 ? (
          <EmptyState title="No languages" description="Add at least English (en) and one target language." />
        ) : (
          <Table minWidth={680}>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Name</Th>
                <Th>Native name</Th>
                <Th>Coverage</Th>
                <Th>Flags</Th>
                <Th className="text-right">Order</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((l) => (
                <tr key={l.code} className={`hover:bg-surface-2/50 ${loading ? "opacity-70" : ""}`}>
                  <Td className="font-mono text-xs">{l.code}</Td>
                  <Td className="font-medium">
                    <Link href={`/languages/${l.code}`} className="hover:text-accent hover:underline">
                      {l.name}
                    </Link>
                  </Td>
                  <Td>{l.native_name ?? <span className="text-muted">—</span>}</Td>
                  <Td>
                    <Coverage lang={l} />
                  </Td>
                  <Td>
                    <span className="flex gap-1">
                      {l.is_active ? <Badge tone="success">active</Badge> : <Badge>inactive</Badge>}
                      {l.is_rtl && <Badge tone="accent">rtl</Badge>}
                      {l.code === "en" && <Badge tone="gold">source</Badge>}
                    </span>
                  </Td>
                  <Td className="text-right tabular-nums">{l.sort_order}</Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      <LinkButton href={`/languages/${l.code}`} size="sm" variant="ghost">
                        Translations
                      </LinkButton>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(l)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" aria-label={`Delete ${l.name}`} onClick={() => setDeleting(l)} disabled={l.code === "en"}>
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
        <LanguageDialog
          language={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setData((prev) => {
              const list = prev ?? [];
              return list.some((l) => l.code === saved.code) ? list.map((l) => (l.code === saved.code ? saved : l)) : [...list, saved];
            });
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={deleting != null}
        title="Remove language"
        message={`Remove ${deleting?.name ?? ""} (${deleting?.code ?? ""})? Its UI translations and series translations may be removed too.`}
        confirmLabel="Remove"
        loading={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

function LanguageDialog({
  language,
  onClose,
  onSaved,
}: {
  language: Language | null;
  onClose: () => void;
  onSaved: (l: Language) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<LanguageIn>({
    code: language?.code ?? "",
    name: language?.name ?? "",
    native_name: language?.native_name ?? "",
    is_active: language?.is_active ?? true,
    is_rtl: language?.is_rtl ?? false,
    sort_order: language?.sort_order ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const { errors, setErrors, clearError, formRef } = useFieldErrors<"code" | "name">();
  const set = <K extends keyof LanguageIn>(k: K, v: LanguageIn[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const code = form.code.trim().toLowerCase();
    const body: LanguageIn = { ...form, code, name: form.name.trim(), native_name: form.native_name?.trim() || null };
    const next: { code?: string; name?: string } = {};
    if (!code) next.code = "Code is required.";
    else if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(code)) next.code = "Use a BCP-47 style code such as hi, ta or pt-br.";
    if (!body.name) next.name = "Name is required.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      const saved = await call(api.PUT("/v1/admin/languages/{code}", { params: { path: { code } }, body }));
      toast.success(language ? "Language saved" : "Language added");
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
      title={language ? `Edit ${language.name}` : "Add language"}
      width="max-w-md"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="language-form" variant="primary" loading={saving}>
            {language ? "Save" : "Add"}
          </Button>
        </>
      }
    >
      <form id="language-form" ref={formRef} onSubmit={submit} className="grid gap-4" noValidate>
        <Field label="Code" required hint="BCP-47 style, e.g. hi, ta, pt-BR." error={errors.code}>
          <Input
            data-autofocus={!language || undefined}
            value={form.code}
            maxLength={10}
            disabled={Boolean(language)}
            onChange={(e) => {
              set("code", e.target.value);
              clearError("code");
            }}
            className="font-mono"
          />
        </Field>
        <Field label="Name" required error={errors.name}>
          <Input
            data-autofocus={language ? true : undefined}
            value={form.name}
            maxLength={80}
            onChange={(e) => {
              set("name", e.target.value);
              clearError("name");
            }}
          />
        </Field>
        <Field label="Native name">
          <Input value={form.native_name ?? ""} onChange={(e) => set("native_name", e.target.value)} />
        </Field>
        <Field label="Sort order">
          <Input type="number" value={form.sort_order} onChange={(e) => set("sort_order", Number(e.target.value) || 0)} />
        </Field>
        <Toggle label="Active" description="Offered to viewers in the language picker." checked={form.is_active ?? true} onChange={(v) => set("is_active", v)} />
        <Toggle label="Right-to-left" checked={form.is_rtl ?? false} onChange={(v) => set("is_rtl", v)} />
      </form>
    </Modal>
  );
}

/**
 * How far this language has actually got.
 *
 * The list showed a language was "active" and nothing else, so a language enabled at 12% translated looked
 * exactly like a finished one — and to a viewer, a half-translated app reads as broken rather than incomplete.
 * English is the source, so it is complete by definition.
 */
function Coverage({ lang }: { lang: Schemas["AdminLanguageOut"] }) {
  if (lang.code === "en") return <span className="text-xs text-muted">source</span>;
  const ui = lang.ui_total > 0 ? Math.round((lang.ui_translated / lang.ui_total) * 100) : 0;
  const pages = lang.pages_total > 0 ? Math.round((lang.pages_translated / lang.pages_total) * 100) : 0;
  const tone = ui >= 95 ? "success" : ui >= 60 ? "warning" : "danger";
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Badge tone={tone}>{ui}% UI</Badge>
      <span className="text-xs text-muted">
        {lang.ui_translated}/{lang.ui_total} strings
        {lang.pages_total > 0 ? ` · ${pages}% pages` : ""}
      </span>
    </span>
  );
}
