"use client";

import { useState, type FormEvent } from "react";
import {
  AD_PLATFORMS,
  AD_PROVIDERS,
  AD_SLOTS,
  isRewardedSlot,
  PROVIDER_LABEL,
  SLOT_LABEL,
  type AdPlacement,
  type AdPlacementIn,
  type AdPlatform,
  type AdProvider,
  type AdSlot,
} from "@/lib/ad-placements";
import { api, call } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
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
  Th,
  Toggle,
} from "@/components/ui";

export default function AdsPage() {
  const toast = useToast();
  const { data, loading, error, refetch, setData } = useQuery("ad-placements", () =>
    call(api.GET("/v1/admin/ad-placements")),
  );
  const [editing, setEditing] = useState<AdPlacement | "new" | null>(null);
  const [deleting, setDeleting] = useState<AdPlacement | null>(null);
  const [busy, setBusy] = useState(false);

  const upsert = (saved: AdPlacement) =>
    setData((prev) => {
      if (!prev) return { items: [saved], total: 1, active: saved.is_active ? 1 : 0 };
      const items = prev.items.some((p) => p.id === saved.id)
        ? prev.items.map((p) => (p.id === saved.id ? saved : p))
        : [...prev.items, saved];
      return { ...prev, items, total: items.length, active: items.filter((p) => p.is_active).length };
    });

  async function toggleActive(p: AdPlacement) {
    const next = { ...p, is_active: !p.is_active };
    // Optimistic, because flipping a placement is the action an operator takes most and a round trip on every
    // toggle makes the switch feel broken. Rolled back below if the write is refused.
    upsert(next);
    try {
      upsert(
        await call(
          api.PUT("/v1/admin/ad-placements/{placement_id}", {
            params: { path: { placement_id: p.id } },
            body: toIn(next),
          }),
        ),
      );
    } catch (e) {
      upsert(p);
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function remove() {
    if (!deleting) return;
    const victim = deleting;
    setBusy(true);
    try {
      await call(api.DELETE("/v1/admin/ad-placements/{placement_id}", { params: { path: { placement_id: victim.id } } }));
      setData((prev) =>
        prev
          ? (() => {
              const items = prev.items.filter((p) => p.id !== victim.id);
              return { ...prev, items, total: items.length, active: items.filter((p) => p.is_active).length };
            })()
          : prev!,
      );
      toast.success(`Deleted “${victim.name}”`);
      setDeleting(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Ad placements"
        description="Where ads may run, and what a rewarded view is worth."
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Icon name="plus" size={15} /> New placement
          </Button>
        }
      />

      {/* An operator's first question here is whether anything is live at all, and it should not require
          reading every row to answer. */}
      {data && (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-2/50 px-3 py-2 text-sm text-ink-2">
          <Icon name="megaphone" size={16} className={data.active > 0 ? "text-warning" : "text-muted"} />
          <span className="flex-1">
            {data.active === 0
              ? "No placements are live. Apps will not request ads."
              : `${data.active} of ${data.total} placement${data.total === 1 ? "" : "s"} live. Apps request these on their next config refresh.`}
          </span>
        </div>
      )}

      <Card>
        {error && !data ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : !data ? (
          <LoadingState />
        ) : data.items.length === 0 ? (
          <EmptyState title="No placements" description="Define a slot, a provider unit id and the platforms it may serve on." />
        ) : (
          <Table minWidth={900}>
            <thead>
              <tr>
                <Th>Placement</Th>
                <Th>Slot</Th>
                <Th>Provider</Th>
                <Th>Platforms</Th>
                <Th className="text-right">Reward</Th>
                <Th className="text-right">Cap</Th>
                <Th>Active</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id} className={`hover:bg-surface-2/50 ${loading ? "opacity-70" : ""}`}>
                  <Td>
                    <span className="block font-medium">{p.name}</span>
                    <span className="block font-mono text-xs text-muted">{p.unit_id}</span>
                  </Td>
                  <Td>
                    <Badge tone={isRewardedSlot(p.slot) ? "gold" : "neutral"}>{SLOT_LABEL[p.slot]}</Badge>
                  </Td>
                  <Td className="text-xs">{PROVIDER_LABEL[p.provider]}</Td>
                  <Td className="text-xs">
                    {p.platforms.length === 0 ? (
                      <span className="text-muted">none</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {p.platforms.map((pl) => (
                          <span key={pl} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">
                            {pl}
                          </span>
                        ))}
                      </span>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{p.reward_coins != null ? `${p.reward_coins} coins` : <span className="text-muted">—</span>}</Td>
                  <Td className="text-right tabular-nums">{p.frequency_cap_sec ? `${p.frequency_cap_sec}s` : <span className="text-muted">none</span>}</Td>
                  <Td>
                    <Toggle label={`${p.name} active`} hideLabel checked={p.is_active} onChange={() => toggleActive(p)} />
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" aria-label={`Delete ${p.name}`} onClick={() => setDeleting(p)}>
                        <Icon name="trash" size={14} className="text-danger" />
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {data && data.items.length > 0 && (
          <p className="border-t border-line px-4 py-2 text-xs text-muted">
            Rewarded placements only serve while the <code className="font-mono">rewarded_ads</code> feature flag is on.
            {` Last change ${fmtDateTime(data.items.map((p) => p.updated_at).filter(Boolean).sort().at(-1) ?? null)}.`}
          </p>
        )}
      </Card>

      {editing && (
        <PlacementDialog
          placement={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            upsert(saved);
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={deleting != null}
        title="Delete placement"
        message={`Delete “${deleting?.name ?? ""}”? Apps stop requesting ads for this slot.`}
        loading={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

function toIn(p: AdPlacement): AdPlacementIn {
  return {
    name: p.name,
    slot: p.slot,
    provider: p.provider,
    unit_id: p.unit_id,
    platforms: p.platforms,
    reward_coins: p.reward_coins,
    frequency_cap_sec: p.frequency_cap_sec,
    is_active: p.is_active,
    sort_order: p.sort_order,
  };
}

type ErrKey = "name" | "unit_id" | "platforms" | "reward_coins" | "frequency_cap_sec";

function PlacementDialog({
  placement,
  onClose,
  onSaved,
}: {
  placement: AdPlacement | null;
  onClose: () => void;
  onSaved: (p: AdPlacement) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: placement?.name ?? "",
    slot: placement?.slot ?? ("unlock_rewarded" as AdSlot),
    provider: placement?.provider ?? ("admob" as AdProvider),
    unit_id: placement?.unit_id ?? "",
    platforms: placement?.platforms ?? (["android"] as AdPlatform[]),
    reward_coins: placement?.reward_coins == null ? "" : String(placement.reward_coins),
    frequency_cap_sec: String(placement?.frequency_cap_sec ?? 300),
    is_active: placement?.is_active ?? false,
    sort_order: placement?.sort_order ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const { errors, setErrors, clearError, formRef } = useFieldErrors<ErrKey>();
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const rewarded = isRewardedSlot(form.slot);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: Partial<Record<ErrKey, string>> = {};
    if (!form.name.trim()) next.name = "Name is required.";
    if (!form.unit_id.trim()) next.unit_id = "The provider's unit id is required.";
    if (form.platforms.length === 0) next.platforms = "Pick at least one platform.";
    const cap = Number(form.frequency_cap_sec);
    if (!Number.isInteger(cap) || cap < 0) next.frequency_cap_sec = "Whole number of seconds (0 for no cap).";
    let reward: number | null = null;
    if (rewarded) {
      reward = Number(form.reward_coins);
      if (form.reward_coins === "" || !Number.isInteger(reward) || reward < 1) next.reward_coins = "Rewarded placements need a whole number of coins, at least 1.";
    }
    setErrors(next);
    if (Object.keys(next).length) return;

    const body: AdPlacementIn = {
      name: form.name.trim(),
      slot: form.slot,
      provider: form.provider,
      unit_id: form.unit_id.trim(),
      platforms: form.platforms,
      reward_coins: reward,
      frequency_cap_sec: cap,
      is_active: form.is_active,
      sort_order: form.sort_order,
    };
    setSaving(true);
    try {
      const saved = placement
        ? await call(
            api.PUT("/v1/admin/ad-placements/{placement_id}", {
              params: { path: { placement_id: placement.id } },
              body,
            }),
          )
        : await call(api.POST("/v1/admin/ad-placements", { body }));
      toast.success(placement ? "Placement saved" : "Placement created");
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
      dismissible={!saving}
      title={placement ? `Edit ${placement.name}` : "New placement"}
      width="max-w-2xl"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="placement-form" variant="primary" loading={saving}>
            {placement ? "Save" : "Create"}
          </Button>
        </>
      }
    >
      <form id="placement-form" ref={formRef} onSubmit={submit} className="grid gap-4 md:grid-cols-2" noValidate>
        <Field label="Name" required error={errors.name} className="md:col-span-2">
          <Input
            data-autofocus
            value={form.name}
            maxLength={120}
            onChange={(e) => {
              set("name", e.target.value);
              clearError("name");
            }}
          />
        </Field>
        <Field label="Slot">
          <Select value={form.slot} onChange={(e) => set("slot", e.target.value as AdSlot)}>
            {AD_SLOTS.map((s) => (
              <option key={s} value={s}>
                {SLOT_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Provider">
          <Select value={form.provider} onChange={(e) => set("provider", e.target.value as AdProvider)}>
            {AD_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABEL[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Unit ID" required hint="Ad unit / placement id from the provider console." error={errors.unit_id} className="md:col-span-2">
          <Input
            value={form.unit_id}
            onChange={(e) => {
              set("unit_id", e.target.value);
              clearError("unit_id");
            }}
            className="font-mono"
          />
        </Field>
        <fieldset className="md:col-span-2">
          <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Platforms</legend>
          <div className="flex flex-wrap gap-2">
            {AD_PLATFORMS.map((pl) => {
              const on = form.platforms.includes(pl);
              return (
                <label
                  key={pl}
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                    on ? "border-accent bg-accent/10 text-accent" : "border-line-strong text-ink-2"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={on}
                    onChange={(e) => {
                      set("platforms", e.target.checked ? [...form.platforms, pl] : form.platforms.filter((x) => x !== pl));
                      clearError("platforms");
                    }}
                  />
                  {pl}
                </label>
              );
            })}
          </div>
          {errors.platforms && (
            <p role="alert" className="mt-2 text-xs text-danger">
              {errors.platforms}
            </p>
          )}
        </fieldset>
        {rewarded && (
          <Field label="Reward (coins)" required hint="Granted once the viewer finishes the ad." error={errors.reward_coins}>
            <Input
              type="number"
              min={1}
              value={form.reward_coins}
              onChange={(e) => {
                set("reward_coins", e.target.value);
                clearError("reward_coins");
              }}
            />
          </Field>
        )}
        <Field label="Frequency cap (seconds)" hint="0 means no cap." error={errors.frequency_cap_sec}>
          <Input
            type="number"
            min={0}
            value={form.frequency_cap_sec}
            onChange={(e) => {
              set("frequency_cap_sec", e.target.value);
              clearError("frequency_cap_sec");
            }}
          />
        </Field>
        <Field label="Sort order">
          <Input type="number" value={form.sort_order} onChange={(e) => set("sort_order", Number(e.target.value) || 0)} />
        </Field>
        <div className="md:col-span-2">
          <Toggle label="Active" description="Inactive placements are never requested by the apps." checked={form.is_active} onChange={(v) => set("is_active", v)} />
        </div>
      </form>
    </Modal>
  );
}
