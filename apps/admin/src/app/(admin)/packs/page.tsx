"use client";

import { useState, type FormEvent } from "react";
import { api, call, type Schemas } from "@/lib/api";
import { economics, warnings } from "@/lib/pack-economics";
import { fmtMoney } from "@/lib/format";
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

type Pack = Schemas["AdminPackOut"];
type PackIn = Schemas["PackIn"];
type Price = Schemas["PackPriceIn"];

export default function PacksPage() {
  const toast = useToast();
  const { data, loading, error, refetch, setData } = useQuery("packs", () => call(api.GET("/v1/admin/packs")));
  const [editing, setEditing] = useState<Pack | "new" | null>(null);
  const [deleting, setDeleting] = useState<Pack | null>(null);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    const victim = deleting;
    try {
      await call(api.DELETE("/v1/admin/packs/{pack_id}", { params: { path: { pack_id: victim.id } } }));
      setData((prev) => (prev ?? []).filter((p) => p.id !== victim.id));
      toast.success(`Deleted “${victim.name}”`);
      setDeleting(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(p: Pack) {
    const next = { ...p, is_active: !p.is_active };
    setData((prev) => (prev ?? []).map((x) => (x.id === p.id ? next : x)));
    try {
      const saved = await call(api.PUT("/v1/admin/packs/{pack_id}", { params: { path: { pack_id: p.id } }, body: toPackIn(next) }));
      setData((prev) => (prev ?? []).map((x) => (x.id === p.id ? saved : x)));
    } catch (e) {
      setData((prev) => (prev ?? []).map((x) => (x.id === p.id ? p : x)));
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  }

  const sorted = [...(data ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.coins - b.coins);
  // The one number that connects coins to rupees. Read from the live economy rather than assumed, because it
  // is the setting that decides what every pack on this screen is actually worth.
  const settings = useQuery("settings:economy", () =>
    call(api.GET("/v1/admin/settings/{namespace}", { params: { path: { namespace: "economy" } } })),
  );
  const episodePrice = Number((settings.data as Record<string, unknown> | undefined)?.episode_price ?? 0);

  return (
    <>
      <PageHeader
        title="Coin packs"
        description="What viewers can buy, with per-currency and per-country prices."
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Icon name="plus" size={15} /> New pack
          </Button>
        }
      />
      <Card>
        {error && !data ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : !data ? (
          <LoadingState />
        ) : sorted.length === 0 ? (
          <EmptyState title="No packs" description="Create coin bundles and VIP passes." />
        ) : (
          <Table minWidth={860}>
            <thead>
              <tr>
                <Th>Pack</Th>
                <Th>Kind</Th>
                <Th className="text-right">Coins</Th>
                <Th>Prices</Th>
                <Th>Value</Th>
                <Th>Store IDs</Th>
                <Th>Active</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.id} className={`hover:bg-surface-2/50 ${loading ? "opacity-70" : ""}`}>
                  <Td>
                    <span className="block font-medium">
                      {p.name} {p.badge && <Badge tone="gold">{p.badge}</Badge>}
                    </span>
                    <span className="font-mono text-xs text-muted">{p.sku}</span>
                  </Td>
                  <Td>
                    <Badge tone={p.kind === "vip" ? "gold" : "neutral"}>
                      {p.kind}
                      {p.kind === "vip" && p.duration_days ? ` · ${p.duration_days}d` : ""}
                    </Badge>
                  </Td>
                  <Td className="text-right tabular-nums">
                    {p.coins}
                    {p.bonus_coins > 0 && <span className="text-xs text-success"> +{p.bonus_coins}</span>}
                  </Td>
                  <Td className="text-xs">
                    {p.prices.length === 0 ? (
                      <span className="text-muted">none</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {p.prices.map((pr, i) => (
                          <span key={i} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">
                            {pr.currency} {pr.amount}
                            {pr.country !== "*" ? ` (${pr.country})` : ""}
                          </span>
                        ))}
                      </span>
                    )}
                  </Td>
                  <Td className="text-xs">
                    {/* What the viewer is really deciding on. The operator setting the price could not see it. */}
                    <PackValue pack={p} all={sorted} episodePrice={episodePrice} />
                  </Td>
                  <Td className="font-mono text-xs text-muted">
                    {p.google_product_id && <span className="block">G: {p.google_product_id}</span>}
                    {p.apple_product_id && <span className="block">A: {p.apple_product_id}</span>}
                    {!p.google_product_id && !p.apple_product_id && "—"}
                  </Td>
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
      </Card>

      {editing && (
        <PackDialog
          pack={editing === "new" ? null : editing}
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
        title="Delete pack"
        message={`Delete “${deleting?.name ?? ""}”? Existing purchases keep their record. Consider deactivating instead.`}
        loading={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

function toPackIn(p: Pack): PackIn {
  return {
    sku: p.sku,
    name: p.name,
    description: p.description,
    kind: p.kind,
    coins: p.coins,
    bonus_coins: p.bonus_coins,
    duration_days: p.duration_days,
    google_product_id: p.google_product_id,
    apple_product_id: p.apple_product_id,
    is_active: p.is_active,
    sort_order: p.sort_order,
    badge: p.badge,
    prices: p.prices,
  };
}

type PriceRow = { currency: string; country: string; amount: string };

function PackDialog({ pack, onClose, onSaved }: { pack: Pack | null; onClose: () => void; onSaved: (p: Pack) => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    sku: pack?.sku ?? "",
    name: pack?.name ?? "",
    description: pack?.description ?? "",
    kind: pack?.kind ?? ("coins" as Schemas["PackKind"]),
    coins: pack?.coins ?? 0,
    bonus_coins: pack?.bonus_coins ?? 0,
    duration_days: pack?.duration_days == null ? "" : String(pack.duration_days),
    google_product_id: pack?.google_product_id ?? "",
    apple_product_id: pack?.apple_product_id ?? "",
    is_active: pack?.is_active ?? true,
    sort_order: pack?.sort_order ?? 0,
    badge: pack?.badge ?? "",
  });
  const [prices, setPrices] = useState<PriceRow[]>(
    pack?.prices.map((p) => ({ currency: p.currency, country: p.country ?? "*", amount: String(p.amount) })) ?? [
      { currency: "INR", country: "*", amount: "" },
    ],
  );
  const [saving, setSaving] = useState(false);
  const { errors, setErrors, clearError, formRef } = useFieldErrors<"sku" | "name" | "prices" | "duration_days">();
  const [badPriceRow, setBadPriceRow] = useState<number | null>(null);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setPrice = (i: number, p: Partial<PriceRow>) => {
    setPrices((rows) => rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
    setBadPriceRow(null);
    clearError("prices");
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: Partial<Record<"sku" | "name" | "prices" | "duration_days", string>> = {};
    if (!form.name.trim()) next.name = "Name is required.";
    if (!form.sku.trim()) next.sku = "SKU is required.";
    if (form.kind === "vip" && form.duration_days !== "" && (!Number.isInteger(Number(form.duration_days)) || Number(form.duration_days) < 1)) {
      next.duration_days = "Whole number of days, at least 1.";
    }
    const cleanPrices: Price[] = [];
    let bad: number | null = null;
    prices.forEach((r, i) => {
      if (bad != null) return;
      const currency = r.currency.trim().toUpperCase();
      const country = (r.country.trim() || "*").toUpperCase();
      if (!currency && !r.amount) return;
      const amount = Number(r.amount);
      if (currency.length !== 3) next.prices = `Row ${i + 1}: currency must be a 3-letter code.`;
      else if (r.amount === "" || !Number.isFinite(amount) || amount < 0) next.prices = `Row ${i + 1}: amount must be a number of 0 or more.`;
      else if (country !== "*" && country.length !== 2) next.prices = `Row ${i + 1}: country must be a 2-letter code or *.`;
      if (next.prices) {
        bad = i;
        return;
      }
      cleanPrices.push({ currency, country, amount });
    });
    setBadPriceRow(bad);
    setErrors(next);
    if (Object.keys(next).length) return;
    const body: PackIn = {
      sku: form.sku.trim(),
      name: form.name.trim(),
      description: form.description.trim() || null,
      kind: form.kind,
      coins: form.coins,
      bonus_coins: form.bonus_coins,
      duration_days: form.duration_days === "" ? null : Number(form.duration_days),
      google_product_id: form.google_product_id.trim() || null,
      apple_product_id: form.apple_product_id.trim() || null,
      is_active: form.is_active,
      sort_order: form.sort_order,
      badge: form.badge.trim() || null,
      prices: cleanPrices,
    };
    setSaving(true);
    try {
      const saved = pack
        ? await call(api.PUT("/v1/admin/packs/{pack_id}", { params: { path: { pack_id: pack.id } }, body }))
        : await call(api.POST("/v1/admin/packs", { body }));
      toast.success(pack ? "Pack saved" : "Pack created");
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
      title={pack ? `Edit ${pack.name}` : "New pack"}
      width="max-w-2xl"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="pack-form" variant="primary" loading={saving}>
            {pack ? "Save" : "Create"}
          </Button>
        </>
      }
    >
      <form id="pack-form" ref={formRef} onSubmit={submit} className="grid gap-4 md:grid-cols-2" noValidate>
        <Field label="Name" required error={errors.name}>
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
        <Field label="SKU" required hint="Stable identifier used by gateways and stores." error={errors.sku}>
          <Input
            value={form.sku}
            maxLength={64}
            onChange={(e) => {
              set("sku", e.target.value);
              clearError("sku");
            }}
            className="font-mono"
          />
        </Field>
        <Field label="Kind">
          <Select value={form.kind} onChange={(e) => set("kind", e.target.value as Schemas["PackKind"])}>
            <option value="coins">Coins</option>
            <option value="vip">VIP pass</option>
          </Select>
        </Field>
        <Field label="Badge" hint="e.g. Best value">
          <Input value={form.badge} onChange={(e) => set("badge", e.target.value)} />
        </Field>
        <Field label="Coins">
          <Input type="number" min={0} value={form.coins} onChange={(e) => set("coins", Math.max(0, Number(e.target.value) || 0))} />
        </Field>
        <Field label="Bonus coins">
          <Input type="number" min={0} value={form.bonus_coins} onChange={(e) => set("bonus_coins", Math.max(0, Number(e.target.value) || 0))} />
        </Field>
        {form.kind === "vip" && (
          <Field label="Duration (days)" error={errors.duration_days}>
            <Input
              type="number"
              min={1}
              value={form.duration_days}
              onChange={(e) => {
                set("duration_days", e.target.value);
                clearError("duration_days");
              }}
            />
          </Field>
        )}
        <Field label="Sort order">
          <Input type="number" value={form.sort_order} onChange={(e) => set("sort_order", Number(e.target.value) || 0)} />
        </Field>
        <Field label="Google product ID">
          <Input value={form.google_product_id} onChange={(e) => set("google_product_id", e.target.value)} className="font-mono" />
        </Field>
        <Field label="Apple product ID">
          <Input value={form.apple_product_id} onChange={(e) => set("apple_product_id", e.target.value)} className="font-mono" />
        </Field>
        <Field label="Description" className="md:col-span-2">
          <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} className="min-h-16" />
        </Field>

        <fieldset className="md:col-span-2">
          <legend className="mb-2 text-[13px] font-medium text-ink-2">Regional prices</legend>
          <div className="scroll-x rounded-lg border border-line">
            <table className="w-full text-sm" style={{ minWidth: 420 }}>
              <thead>
                <tr>
                  <Th>Currency</Th>
                  <Th>Country</Th>
                  <Th>Amount</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {prices.map((r, i) => (
                  <tr key={i}>
                    <Td>
                      <Input
                        aria-label="Currency"
                        aria-invalid={badPriceRow === i || undefined}
                        value={r.currency}
                        maxLength={3}
                        placeholder="INR"
                        onChange={(e) => setPrice(i, { currency: e.target.value.toUpperCase() })}
                        className="h-9 w-24 font-mono uppercase"
                      />
                    </Td>
                    <Td>
                      <Input
                        aria-label="Country"
                        value={r.country}
                        maxLength={2}
                        placeholder="*"
                        onChange={(e) => setPrice(i, { country: e.target.value.toUpperCase() })}
                        className="h-9 w-20 font-mono uppercase"
                      />
                    </Td>
                    <Td>
                      <Input
                        aria-label="Amount"
                        type="number"
                        min={0}
                        step="0.01"
                        value={r.amount}
                        onChange={(e) => setPrice(i, { amount: e.target.value })}
                        className="h-9 w-32"
                      />
                    </Td>
                    <Td className="text-right">
                      <Button size="sm" variant="ghost" aria-label="Remove price" onClick={() => setPrices((rows) => rows.filter((_, j) => j !== i))}>
                        <Icon name="trash" size={14} className="text-danger" />
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {errors.prices && (
            <p role="alert" className="mt-2 text-xs text-danger">
              {errors.prices}
            </p>
          )}
          <div className="mt-2 flex items-center justify-between">
            <p className="text-xs text-muted">Country “*” is the fallback for that currency.</p>
            <Button size="sm" onClick={() => setPrices((rows) => [...rows, { currency: "", country: "*", amount: "" }])}>
              <Icon name="plus" size={13} /> Add price
            </Button>
          </div>
        </fieldset>

        <div className="md:col-span-2">
          <Toggle label="Active" description="Inactive packs are hidden from the store." checked={form.is_active} onChange={(v) => set("is_active", v)} />
        </div>
      </form>
    </Modal>
  );
}

/**
 * Per-episode price, bonus, and anything wrong that only shows when the packs are compared with each other.
 *
 * Advisory rather than blocking: a promotional pack that is briefly poor value is a legitimate decision, and
 * an operator who has decided that does not need to be argued with — only told.
 */
function PackValue({ pack, all, episodePrice }: { pack: Pack; all: Pack[]; episodePrice: number }) {
  const e = economics(pack, episodePrice);
  const issues = warnings(pack, all, episodePrice);

  if (!e && issues.length === 0) return <span className="text-muted">—</span>;

  return (
    <span className="flex flex-col gap-1">
      {e ? (
        <>
          <span className="tabular-nums text-ink">
            {fmtMoney(Math.round(e.perEpisode * 100) / 100, e.currency)}
            <span className="text-muted"> / episode</span>
          </span>
          <span className="text-muted">
            {e.episodes} episode{e.episodes === 1 ? "" : "s"}
            {e.bonusPct > 0 ? ` · +${e.bonusPct}% bonus` : ""}
          </span>
        </>
      ) : null}
      {issues.map((w) => (
        <span key={w.kind} className="flex max-w-[18rem] items-start gap-1 text-warning">
          <Icon name="flag" size={12} className="mt-0.5 shrink-0" />
          <span>{w.message}</span>
        </span>
      ))}
    </span>
  );
}
