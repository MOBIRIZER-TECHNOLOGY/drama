"use client";

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
  LoadingState,
  Modal,
  PageHeader,
  Select,
  Table,
  Td,
  Textarea,
  Th,
  Toggle,
} from "@/components/ui";

type Task = Schemas["AdminRewardTaskOut"];
type TaskIn = Schemas["RewardTaskIn"];
type Platform = Schemas["Platform"];

const PLATFORMS: Platform[] = ["web", "android", "ios"];
const KINDS: Schemas["RewardTaskKind"][] = ["link", "rewarded_ad", "share", "follow"];

export default function RewardsPage() {
  const toast = useToast();
  const { data, loading, error, refetch, setData } = useQuery("reward-tasks", () => call(api.GET("/v1/admin/reward-tasks")));
  const [editing, setEditing] = useState<{ task: Task | null; platform: Platform } | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    const victim = deleting;
    try {
      await call(api.DELETE("/v1/admin/reward-tasks/{task_id}", { params: { path: { task_id: victim.id } } }));
      setData((prev) => (prev ?? []).filter((t) => t.id !== victim.id));
      toast.success(`Deleted “${victim.title}”`);
      setDeleting(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(t: Task) {
    const next = { ...t, is_active: !t.is_active };
    setData((prev) => (prev ?? []).map((x) => (x.id === t.id ? next : x)));
    try {
      const saved = await call(api.PUT("/v1/admin/reward-tasks/{task_id}", { params: { path: { task_id: t.id } }, body: toTaskIn(next) }));
      setData((prev) => (prev ?? []).map((x) => (x.id === t.id ? saved : x)));
    } catch (e) {
      setData((prev) => (prev ?? []).map((x) => (x.id === t.id ? t : x)));
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  }

  return (
    <>
      <PageHeader
        title="Reward tasks"
        description="Ways viewers earn coins, per platform. Daily check-in is configured in Settings › rewards."
        actions={
          <Button variant="primary" onClick={() => setEditing({ task: null, platform: "android" })}>
            <Icon name="plus" size={15} /> New task
          </Button>
        }
      />

      {/* A rewarded task pays out only when AdMob's signed callback reaches us, and the operator setting up
          the ad unit is the person who has to paste that URL into the AdMob console. Nowhere else says it. */}
      {(data ?? []).some((t) => t.kind === "rewarded_ad") && <SsvHint />}

      {error && !data ? (
        <Card>
          <ErrorState message={error} onRetry={refetch} />
        </Card>
      ) : !data ? (
        <Card>
          <LoadingState />
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {PLATFORMS.map((platform) => {
            const rows = data.filter((t) => t.platform === platform).sort((a, b) => a.sort_order - b.sort_order);
            return (
              <Card
                key={platform}
                title={platformLabel(platform)}
                actions={
                  <Button size="sm" onClick={() => setEditing({ task: null, platform })}>
                    <Icon name="plus" size={13} /> Add
                  </Button>
                }
              >
                {rows.length === 0 ? (
                  <EmptyState title={`No tasks for ${platformLabel(platform)}`} />
                ) : (
                  <Table minWidth={720}>
                    <thead>
                      <tr>
                        <Th>Task</Th>
                        <Th>Kind</Th>
                        <Th className="text-right">Coins</Th>
                        <Th>Frequency</Th>
                        <Th>Timer</Th>
                        <Th>Active</Th>
                        <Th className="text-right">Actions</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((t) => (
                        <tr key={t.id} className={`hover:bg-surface-2/50 ${loading ? "opacity-70" : ""}`}>
                          <Td>
                            <span className="block font-medium">{t.title}</span>
                            {t.url && (
                              <a href={t.url} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
                                {t.url}
                              </a>
                            )}
                          </Td>
                          <Td>
                            <Badge>{t.kind.replace("_", " ")}</Badge>
                          </Td>
                          <Td className="text-right tabular-nums">{t.coins}</Td>
                          <Td className="capitalize">{t.frequency}</Td>
                          <Td className="text-muted">{t.timer_seconds ? `${t.timer_seconds}s` : "—"}</Td>
                          <Td>
                            <Toggle label={`${t.title} active`} hideLabel checked={t.is_active} onChange={() => toggleActive(t)} />
                          </Td>
                          <Td className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="ghost" onClick={() => setEditing({ task: t, platform })}>
                                Edit
                              </Button>
                              <Button size="sm" variant="ghost" aria-label={`Delete ${t.title}`} onClick={() => setDeleting(t)}>
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
            );
          })}
        </div>
      )}

      {editing && (
        <TaskDialog
          task={editing.task}
          platform={editing.platform}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setData((prev) => {
              const list = prev ?? [];
              return list.some((t) => t.id === saved.id) ? list.map((t) => (t.id === saved.id ? saved : t)) : [...list, saved];
            });
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={deleting != null}
        title="Delete task"
        message={`Delete “${deleting?.title ?? ""}”? Viewers who already claimed it keep their coins.`}
        loading={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

function platformLabel(p: Platform) {
  return p === "ios" ? "iOS" : p === "android" ? "Android" : "Web";
}

function toTaskIn(t: Task): TaskIn {
  return {
    platform: t.platform,
    kind: t.kind,
    title: t.title,
    description: t.description,
    coins: t.coins,
    url: t.url,
    timer_seconds: t.timer_seconds,
    frequency: t.frequency,
    is_active: t.is_active,
    sort_order: t.sort_order,
  };
}

function TaskDialog({
  task,
  platform,
  onClose,
  onSaved,
}: {
  task: Task | null;
  platform: Platform;
  onClose: () => void;
  onSaved: (t: Task) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<TaskIn>({
    platform: task?.platform ?? platform,
    kind: task?.kind ?? "link",
    title: task?.title ?? "",
    description: task?.description ?? "",
    coins: task?.coins ?? 10,
    url: task?.url ?? "",
    timer_seconds: task?.timer_seconds ?? 0,
    frequency: task?.frequency ?? "once",
    is_active: task?.is_active ?? true,
    sort_order: task?.sort_order ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const { errors, setErrors, clearError, formRef } = useFieldErrors<"title" | "coins" | "url">();
  const set = <K extends keyof TaskIn>(k: K, v: TaskIn[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body: TaskIn = {
      ...form,
      title: form.title.trim(),
      description: form.description?.trim() || null,
      url: form.url?.trim() || null,
    };
    const next: Partial<Record<"title" | "coins" | "url", string>> = {};
    if (!body.title) next.title = "Title is required.";
    if (!Number.isInteger(body.coins) || (body.coins ?? 0) < 1) next.coins = "Coins must be a whole number of at least 1.";
    if (body.url) {
      try {
        const u = new URL(body.url);
        if (u.protocol !== "https:" && u.protocol !== "http:") next.url = "Use an http(s) URL.";
      } catch {
        next.url = "Enter a full URL, e.g. https://example.com/page.";
      }
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      const saved = task
        ? await call(api.PUT("/v1/admin/reward-tasks/{task_id}", { params: { path: { task_id: task.id } }, body }))
        : await call(api.POST("/v1/admin/reward-tasks", { body }));
      toast.success(task ? "Task saved" : "Task created");
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
      title={task ? "Edit task" : "New task"}
      width="max-w-xl"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="task-form" variant="primary" loading={saving}>
            {task ? "Save" : "Create"}
          </Button>
        </>
      }
    >
      <form id="task-form" ref={formRef} onSubmit={submit} className="grid gap-4 md:grid-cols-2" noValidate>
        <Field label="Title" required className="md:col-span-2" error={errors.title}>
          <Input
            data-autofocus
            value={form.title}
            maxLength={160}
            onChange={(e) => {
              set("title", e.target.value);
              clearError("title");
            }}
          />
        </Field>
        <Field label="Platform">
          <Select value={form.platform} onChange={(e) => set("platform", e.target.value as Platform)}>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {platformLabel(p)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Kind">
          <Select value={form.kind} onChange={(e) => set("kind", e.target.value as Schemas["RewardTaskKind"])}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k.replace("_", " ")}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Coins" required error={errors.coins}>
          <Input
            type="number"
            min={1}
            value={form.coins}
            onChange={(e) => {
              set("coins", Number(e.target.value));
              clearError("coins");
            }}
          />
        </Field>
        <Field label="Frequency">
          <Select value={form.frequency} onChange={(e) => set("frequency", e.target.value as Schemas["RewardFrequency"])}>
            <option value="once">Once</option>
            <option value="daily">Daily</option>
          </Select>
        </Field>
        <Field label="URL" hint="Link, share or follow destination." className="md:col-span-2" error={errors.url}>
          <Input
            type="url"
            value={form.url ?? ""}
            onChange={(e) => {
              set("url", e.target.value);
              clearError("url");
            }}
          />
        </Field>
        <Field label="Timer (seconds)" hint="How long the viewer must stay before claiming.">
          <Input type="number" min={0} value={form.timer_seconds} onChange={(e) => set("timer_seconds", Math.max(0, Number(e.target.value) || 0))} />
        </Field>
        <Field label="Sort order">
          <Input type="number" value={form.sort_order} onChange={(e) => set("sort_order", Number(e.target.value) || 0)} />
        </Field>
        <Field label="Description" className="md:col-span-2">
          <Textarea value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} className="min-h-16" />
        </Field>
        <div className="md:col-span-2">
          <Toggle label="Active" checked={form.is_active ?? true} onChange={(v) => set("is_active", v)} />
        </div>
      </form>
    </Modal>
  );
}

/**
 * Where AdMob has to call.
 *
 * A rewarded task grants nothing until Google's server-side verification callback reaches the API and is
 * verified against Google's published keys — no callback, no coins, and no error anywhere to explain why.
 * The person configuring the ad unit is the person reading this screen, so the URL belongs here.
 */
function SsvHint() {
  const [copied, setCopied] = useState(false);
  const base = process.env.NEXT_PUBLIC_API_URL ?? "";
  const url = `${base}/v1/ads/admob/ssv`;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-2/50 px-3 py-2.5 text-sm text-ink-2">
      <Icon name="megaphone" size={16} className="text-muted" />
      <span className="flex-1 min-w-[16rem]">
        Rewarded tasks pay out only when AdMob&rsquo;s verification callback reaches us. Set this as the
        server-side verification URL on the ad unit:
        <code className="ms-2 rounded bg-surface px-1.5 py-0.5 font-mono text-xs">{url}</code>
      </span>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          void navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
