"use client";

import { useState, type FormEvent } from "react";
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
  Table,
  Td,
  Th,
  Toggle,
} from "@/components/ui";

type Category = Schemas["AdminCategoryOut"];
type CategoryIn = Schemas["CategoryIn"];

export default function CategoriesPage() {
  const toast = useToast();
  const { data, loading, error, refetch, setData } = useQuery("categories", () => call(api.GET("/v1/admin/categories")));
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    const victim = deleting;
    try {
      await call(api.DELETE("/v1/admin/categories/{category_id}", { params: { path: { category_id: victim.id } } }));
      setData((prev) => (prev ?? []).filter((c) => c.id !== victim.id));
      toast.success(`Deleted “${victim.name}”`);
      setDeleting(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...(data ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader
        title="Categories"
        description="Genres shown as home rails and catalogue filters."
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Icon name="plus" size={15} /> New category
          </Button>
        }
      />
      <Card>
        {error && !data ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : !data ? (
          <LoadingState />
        ) : sorted.length === 0 ? (
          <EmptyState title="No categories" description="Create genres like Romance, Revenge or Fantasy." />
        ) : (
          <Table minWidth={560}>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Slug</Th>
                <Th>Home</Th>
                <Th className="text-right">Order</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => (
                <tr key={c.id} className={`hover:bg-surface-2/50 ${loading ? "opacity-70" : ""}`}>
                  <Td className="font-medium">{c.name}</Td>
                  <Td className="font-mono text-xs text-muted">{c.slug}</Td>
                  <Td>{c.show_on_home ? <Badge tone="success">shown</Badge> : <Badge>hidden</Badge>}</Td>
                  <Td className="text-right tabular-nums">{c.sort_order}</Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}>
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
        <CategoryDialog
          category={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setData((prev) => {
              const list = prev ?? [];
              return list.some((c) => c.id === saved.id) ? list.map((c) => (c.id === saved.id ? saved : c)) : [...list, saved];
            });
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={deleting != null}
        title="Delete category"
        message={`Delete “${deleting?.name ?? ""}”? Series keep their other categories.`}
        loading={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

function CategoryDialog({
  category,
  onClose,
  onSaved,
}: {
  category: Category | null;
  onClose: () => void;
  onSaved: (c: Category) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<CategoryIn>({
    name: category?.name ?? "",
    slug: category?.slug ?? "",
    show_on_home: category?.show_on_home ?? true,
    sort_order: category?.sort_order ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const [slugTouched, setSlugTouched] = useState(Boolean(category));
  const { errors, setErrors, clearError, formRef } = useFieldErrors<"name" | "slug">();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body: CategoryIn = { ...form, name: form.name.trim(), slug: (form.slug || slugify(form.name)).trim() };
    const next: { name?: string; slug?: string } = {};
    if (!body.name) next.name = "Name is required.";
    if (!body.slug) next.slug = "Slug is required.";
    else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.slug)) next.slug = "Use lowercase letters, digits and single hyphens.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      const saved = category
        ? await call(api.PUT("/v1/admin/categories/{category_id}", { params: { path: { category_id: category.id } }, body }))
        : await call(api.POST("/v1/admin/categories", { body }));
      toast.success(category ? "Category saved" : "Category created");
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
      title={category ? "Edit category" : "New category"}
      width="max-w-md"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="category-form" variant="primary" loading={saving}>
            {category ? "Save" : "Create"}
          </Button>
        </>
      }
    >
      <form id="category-form" ref={formRef} onSubmit={submit} className="grid gap-4" noValidate>
        <Field label="Name" required error={errors.name}>
          <Input
            data-autofocus
            value={form.name}
            maxLength={80}
            onChange={(e) => {
              setForm((f) => ({ ...f, name: e.target.value, slug: slugTouched ? f.slug : slugify(e.target.value) }));
              clearError("name");
              if (!slugTouched) clearError("slug");
            }}
          />
        </Field>
        <Field label="Slug" required error={errors.slug}>
          <Input
            value={form.slug}
            maxLength={80}
            onChange={(e) => {
              setSlugTouched(true);
              setForm((f) => ({ ...f, slug: e.target.value }));
              clearError("slug");
            }}
          />
        </Field>
        <Field label="Sort order">
          <Input type="number" value={form.sort_order} onChange={(e) => setForm((f) => ({ ...f, sort_order: Number(e.target.value) || 0 }))} />
        </Field>
        <Toggle label="Show on home" description="Render a rail for this category on the home screen." checked={form.show_on_home} onChange={(v) => setForm((f) => ({ ...f, show_on_home: v }))} />
      </form>
    </Modal>
  );
}
