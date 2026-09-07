"use client";

import { useState, type FormEvent } from "react";
import { api, call, type Schemas } from "@/lib/api";
import { fmtDate, fromLocalInput, toLocalInput } from "@/lib/format";
import { useFieldErrors } from "@/lib/forms";
import { useQuery } from "@/lib/use-query";
import { Icon } from "@/components/icons";
import { formatJson, JsonEditor, parseJsonObject, type JsonObject } from "@/components/json-editor";
import { useToast } from "@/components/toast";
import {
  Badge,
  Button,
  Card,
  ChipInput,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  InlineError,
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

type Offer = Schemas["app__api__routers__admin_growth__OfferOut"];
type OfferIn = Schemas["OfferIn"];
type Coupon = Schemas["CouponOut"];
type Pack = Schemas["AdminPackOut"];

const KINDS = ["first_purchase", "bundle", "winback", "coupon"] as const;
type Kind = (typeof KINDS)[number];
const KIND_LABEL: Record<Kind, string> = {
  first_purchase: "First purchase",
  bundle: "Bundle",
  winback: "Win-back",
  coupon: "Coupon",
};
const COUPON_RE = /^[A-Z0-9]{4,32}$/;

function offerWindow(o: Offer): { label: string; tone: "success" | "warning" | "neutral" } {
  const now = Date.now();
  const starts = o.starts_at ? new Date(o.starts_at).getTime() : null;
  const ends = o.ends_at ? new Date(o.ends_at).getTime() : null;
  if (!o.is_active) return { label: "inactive", tone: "neutral" };
  if (starts != null && starts > now) return { label: "scheduled", tone: "warning" };
  if (ends != null && ends < now) return { label: "expired", tone: "neutral" };
  return { label: "live", tone: "success" };
}

export default function OffersPage() {
  const toast = useToast();
  const { data, loading, error, refetch, setData } = useQuery("offers", () => call(api.GET("/v1/admin/offers")));
  const packs = useQuery("packs", () => call(api.GET("/v1/admin/packs")));
  const [editing, setEditing] = useState<Offer | "new" | null>(null);
  const [coupons, setCoupons] = useState<Offer | null>(null);
  const [deactivating, setDeactivating] = useState<Offer | null>(null);
  const [busy, setBusy] = useState(false);

  const packName = (id: string | null | undefined) => (id ? (packs.data?.find((p) => p.id === id)?.name ?? `${id.slice(0, 8)}…`) : null);

  const upsert = (saved: Offer) =>
    setData((prev) => {
      const list = prev ?? [];
      return list.some((o) => o.id === saved.id) ? list.map((o) => (o.id === saved.id ? saved : o)) : [saved, ...list];
    });

  async function setActive(o: Offer, is_active: boolean) {
    setBusy(true);
    try {
      const saved = await call(api.PUT("/v1/admin/offers/{offer_id}", { params: { path: { offer_id: o.id } }, body: { ...toOfferIn(o), is_active } }));
      upsert(saved);
      toast.success(is_active ? "Offer activated" : "Offer deactivated");
      setDeactivating(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  // Keep the coupons drawer in sync with the list after edits.
  const couponsOffer = coupons ? (data?.find((o) => o.id === coupons.id) ?? coupons) : null;

  return (
    <>
      <PageHeader
        title="Offers & coupons"
        description="Discounts and promotions on coin packs, with optional coupon codes."
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Icon name="plus" size={15} /> New offer
          </Button>
        }
      />
      <Card>
        {error && data && <InlineError message={error} onRetry={refetch} />}
        {error && !data ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : !data ? (
          <LoadingState />
        ) : data.length === 0 ? (
          <EmptyState title="No offers" description="Create a first-purchase discount, a win-back deal or a coupon campaign." />
        ) : (
          <Table minWidth={900}>
            <thead>
              <tr>
                <Th>Offer</Th>
                <Th>Kind</Th>
                <Th>Pack</Th>
                <Th className="text-right">Discount</Th>
                <Th>Window</Th>
                <Th>Coupons</Th>
                <Th>State</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {data.map((o) => {
                const w = offerWindow(o);
                const used = o.coupons.reduce((n, c) => n + c.used, 0);
                return (
                  <tr key={o.id} className={`hover:bg-surface-2/50 ${loading ? "opacity-70" : ""}`}>
                    <Td>
                      <span className="block font-medium">{o.title}</span>
                      {o.eligibility && Object.keys(o.eligibility).length > 0 && (
                        <span className="block max-w-xs truncate font-mono text-[11px] text-muted" title={formatJson(o.eligibility)}>
                          {JSON.stringify(o.eligibility)}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={o.kind === "coupon" ? "accent" : "neutral"}>{KIND_LABEL[o.kind as Kind] ?? o.kind}</Badge>
                    </Td>
                    <Td className="text-xs">{packName(o.pack_id) ?? <span className="text-muted">any</span>}</Td>
                    <Td className="text-right tabular-nums">{o.discount_pct != null ? `${o.discount_pct}%` : <span className="text-muted">—</span>}</Td>
                    <Td className="whitespace-nowrap text-xs text-muted">
                      {o.starts_at || o.ends_at ? `${fmtDate(o.starts_at)} → ${fmtDate(o.ends_at)}` : "always"}
                    </Td>
                    <Td className="text-xs">
                      {o.coupons.length === 0 ? (
                        <span className="text-muted">none</span>
                      ) : (
                        <span>
                          {o.coupons.length} code{o.coupons.length === 1 ? "" : "s"} · {used} used
                        </span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={w.tone}>{w.label}</Badge>
                    </Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setCoupons(o)}>
                          <Icon name="ticket" size={14} /> Coupons
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(o)}>
                          Edit
                        </Button>
                        {o.is_active ? (
                          <Button size="sm" variant="ghost" onClick={() => setDeactivating(o)}>
                            Deactivate
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" loading={busy} onClick={() => setActive(o, true)}>
                            Activate
                          </Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {editing && (
        <OfferDialog
          offer={editing === "new" ? null : editing}
          packs={packs.data ?? []}
          packsError={packs.error}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            upsert(saved);
            setEditing(null);
          }}
        />
      )}

      {couponsOffer && (
        <CouponsDrawer
          offer={couponsOffer}
          onClose={() => setCoupons(null)}
          onChanged={(next) => upsert({ ...couponsOffer, coupons: next })}
        />
      )}

      <ConfirmDialog
        open={deactivating != null}
        title="Deactivate offer"
        message={`Deactivate “${deactivating?.title ?? ""}”? Viewers stop seeing it and its coupon codes stop working until it is activated again.`}
        confirmLabel="Deactivate"
        loading={busy}
        onConfirm={() => deactivating && setActive(deactivating, false)}
        onCancel={() => setDeactivating(null)}
      />
    </>
  );
}

function toOfferIn(o: Offer): OfferIn {
  return {
    title: o.title,
    kind: o.kind,
    pack_id: o.pack_id ?? null,
    discount_pct: o.discount_pct ?? null,
    eligibility: o.eligibility ?? null,
    starts_at: o.starts_at ?? null,
    ends_at: o.ends_at ?? null,
    is_active: o.is_active,
  };
}

/* ---------- offer dialog ---------- */

type ErrKey = "title" | "discount_pct" | "window" | "eligibility";

/** Eligibility helpers: the two common keys get dedicated controls; anything else stays in the JSON editor. */
function splitEligibility(e: JsonObject | null | undefined) {
  const src = e ?? {};
  const countries = Array.isArray(src.countries) ? src.countries.filter((c): c is string => typeof c === "string") : [];
  const inactive = typeof src.inactive_days === "number" ? String(src.inactive_days) : "";
  const rest: JsonObject = {};
  for (const [k, v] of Object.entries(src)) if (k !== "countries" && k !== "inactive_days") rest[k] = v;
  return { countries, inactive, rest: Object.keys(rest).length ? formatJson(rest) : "" };
}

function OfferDialog({
  offer,
  packs,
  packsError,
  onClose,
  onSaved,
}: {
  offer: Offer | null;
  packs: Pack[];
  packsError?: string;
  onClose: () => void;
  onSaved: (o: Offer) => void;
}) {
  const toast = useToast();
  const init = splitEligibility(offer?.eligibility as JsonObject | null | undefined);
  const [form, setForm] = useState({
    title: offer?.title ?? "",
    kind: (offer?.kind as Kind) ?? ("first_purchase" as Kind),
    pack_id: offer?.pack_id ?? "",
    discount_pct: offer?.discount_pct == null ? "" : String(offer.discount_pct),
    starts_at: toLocalInput(offer?.starts_at),
    ends_at: toLocalInput(offer?.ends_at),
    is_active: offer?.is_active ?? true,
  });
  const [countries, setCountries] = useState<string[]>(init.countries);
  const [inactiveDays, setInactiveDays] = useState(init.inactive);
  const [extra, setExtra] = useState(init.rest);
  const [saving, setSaving] = useState(false);
  const { errors, setErrors, clearError, formRef } = useFieldErrors<ErrKey>();
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: Partial<Record<ErrKey, string>> = {};
    if (!form.title.trim()) next.title = "Title is required.";
    let discount: number | null = null;
    if (form.discount_pct !== "") {
      discount = Number(form.discount_pct);
      if (!Number.isInteger(discount) || discount < 1 || discount > 90) next.discount_pct = "Whole number from 1 to 90, or blank.";
    }
    const starts = fromLocalInput(form.starts_at);
    const ends = fromLocalInput(form.ends_at);
    if (starts && ends && new Date(starts) >= new Date(ends)) next.window = "End must be after start.";
    const parsed = parseJsonObject(extra);
    if (!parsed.ok) next.eligibility = parsed.error;
    const badCountry = countries.find((c) => !/^[A-Z]{2}$/.test(c));
    if (badCountry) next.eligibility = `“${badCountry}” is not a 2-letter ISO country code.`;
    if (inactiveDays !== "" && (!Number.isInteger(Number(inactiveDays)) || Number(inactiveDays) < 1)) next.eligibility = "Inactive days must be a whole number of 1 or more.";
    setErrors(next);
    if (Object.keys(next).length || !parsed.ok) return;

    const eligibility: JsonObject = { ...parsed.value };
    if (countries.length) eligibility.countries = countries;
    if (inactiveDays !== "") eligibility.inactive_days = Number(inactiveDays);
    if (form.kind === "first_purchase" && eligibility.first_purchase === undefined) eligibility.first_purchase = true;

    const body: OfferIn = {
      title: form.title.trim(),
      kind: form.kind,
      pack_id: form.pack_id || null,
      discount_pct: discount,
      eligibility: Object.keys(eligibility).length ? eligibility : null,
      starts_at: starts,
      ends_at: ends,
      is_active: form.is_active,
    };
    setSaving(true);
    try {
      const saved = offer
        ? await call(api.PUT("/v1/admin/offers/{offer_id}", { params: { path: { offer_id: offer.id } }, body }))
        : await call(api.POST("/v1/admin/offers", { body }));
      toast.success(offer ? "Offer saved" : "Offer created");
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
      title={offer ? `Edit ${offer.title}` : "New offer"}
      width="max-w-2xl"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="offer-form" variant="primary" loading={saving}>
            {offer ? "Save" : "Create"}
          </Button>
        </>
      }
    >
      <form id="offer-form" ref={formRef} onSubmit={submit} className="grid gap-4 md:grid-cols-2" noValidate>
        <Field label="Title" required error={errors.title} className="md:col-span-2">
          <Input
            data-autofocus
            value={form.title}
            maxLength={120}
            onChange={(e) => {
              set("title", e.target.value);
              clearError("title");
            }}
          />
        </Field>
        <Field label="Kind">
          <Select value={form.kind} onChange={(e) => set("kind", e.target.value as Kind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Pack" hint={packsError ? `Packs failed to load: ${packsError}` : "Blank applies to any pack."}>
          <Select value={form.pack_id} onChange={(e) => set("pack_id", e.target.value)}>
            <option value="">Any pack</option>
            {packs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.sku}){p.is_active ? "" : " · inactive"}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Discount %" hint="1–90, or blank for a non-price offer." error={errors.discount_pct}>
          <Input
            type="number"
            min={1}
            max={90}
            value={form.discount_pct}
            onChange={(e) => {
              set("discount_pct", e.target.value);
              clearError("discount_pct");
            }}
          />
        </Field>
        <div className="md:col-span-1" />
        <Field label="Starts at" hint="Blank starts immediately.">
          <Input
            type="datetime-local"
            value={form.starts_at}
            onChange={(e) => {
              set("starts_at", e.target.value);
              clearError("window");
            }}
          />
        </Field>
        <Field label="Ends at" hint="Blank never expires." error={errors.window}>
          <Input
            type="datetime-local"
            value={form.ends_at}
            onChange={(e) => {
              set("ends_at", e.target.value);
              clearError("window");
            }}
          />
        </Field>

        <fieldset className="md:col-span-2 grid gap-4 rounded-lg border border-line p-3 md:grid-cols-2">
          <legend className="px-1 text-[13px] font-medium text-ink-2">Eligibility</legend>
          <Field label="Countries" hint="ISO 3166 codes, e.g. IN. Blank means every country." className="md:col-span-2">
            <ChipInput
              label="Countries"
              values={countries}
              placeholder="IN, US…"
              onChange={(v) => {
                setCountries(v.map((c) => c.trim().toUpperCase()).filter(Boolean));
                clearError("eligibility");
              }}
            />
          </Field>
          <Field label="Inactive for (days)" hint="Win-back: viewers not seen for at least this long.">
            <Input
              type="number"
              min={1}
              value={inactiveDays}
              onChange={(e) => {
                setInactiveDays(e.target.value);
                clearError("eligibility");
              }}
            />
          </Field>
          <Field label="Other rules (JSON)" hint='e.g. {"first_purchase": true}' error={errors.eligibility} className="md:col-span-2">
            <JsonEditor
              value={extra}
              error={errors.eligibility}
              rows={3}
              onChange={(t) => {
                setExtra(t);
                clearError("eligibility");
              }}
            />
          </Field>
        </fieldset>

        <div className="md:col-span-2">
          <Toggle label="Active" description="Inactive offers are hidden and their coupons rejected." checked={form.is_active} onChange={(v) => set("is_active", v)} />
        </div>
      </form>
    </Modal>
  );
}

/* ---------- coupons ---------- */

function CouponsDrawer({ offer, onClose, onChanged }: { offer: Offer; onClose: () => void; onChanged: (coupons: Coupon[]) => void }) {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Coupon | null>(null);
  const [busy, setBusy] = useState(false);
  const { errors, setErrors, clearError, formRef } = useFieldErrors<"code" | "max_uses">();

  async function add(e: FormEvent) {
    e.preventDefault();
    const next: { code?: string; max_uses?: string } = {};
    const clean = code.trim().toUpperCase();
    if (!COUPON_RE.test(clean)) next.code = "4–32 uppercase letters or digits.";
    if (offer.coupons.some((c) => c.code === clean)) next.code = "This offer already has that code.";
    if (maxUses !== "" && (!Number.isInteger(Number(maxUses)) || Number(maxUses) < 1)) next.max_uses = "Whole number of 1 or more, or blank for unlimited.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setAdding(true);
    try {
      const saved = await call(
        api.POST("/v1/admin/offers/{offer_id}/coupons", {
          params: { path: { offer_id: offer.id } },
          body: { code: clean, max_uses: maxUses === "" ? null : Number(maxUses) },
        }),
      );
      onChanged([...offer.coupons, saved]);
      setCode("");
      setMaxUses("");
      toast.success(`Coupon ${saved.code} added`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Add failed";
      if (/code/i.test(msg)) setErrors({ code: msg });
      else toast.error(msg);
    } finally {
      setAdding(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    const victim = deleting;
    setBusy(true);
    try {
      await call(api.DELETE("/v1/admin/coupons/{coupon_id}", { params: { path: { coupon_id: victim.id } } }));
      onChanged(offer.coupons.filter((c) => c.id !== victim.id));
      toast.success(`Deleted ${victim.code}`);
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Coupons · ${offer.title}`} side>
      <form ref={formRef} onSubmit={add} className="mb-5 grid gap-3 rounded-lg border border-line bg-surface-2/40 p-3 md:grid-cols-[1fr_140px_auto]" noValidate>
        <Field label="Code" required error={errors.code}>
          <Input
            data-autofocus
            value={code}
            maxLength={32}
            placeholder="WELCOME20"
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              clearError("code");
            }}
            className="font-mono uppercase"
          />
        </Field>
        <Field label="Max uses" hint="Blank = unlimited" error={errors.max_uses}>
          <Input
            type="number"
            min={1}
            value={maxUses}
            onChange={(e) => {
              setMaxUses(e.target.value);
              clearError("max_uses");
            }}
          />
        </Field>
        <div className="flex items-end">
          <Button type="submit" variant="primary" loading={adding}>
            <Icon name="plus" size={14} /> Add
          </Button>
        </div>
      </form>

      {offer.coupons.length === 0 ? (
        <EmptyState title="No coupons yet" description="Add a code above. Codes are unique across all offers." />
      ) : (
        <Table minWidth={360}>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th className="text-right">Used</Th>
              <Th className="text-right">Max</Th>
              <Th className="text-right">
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {offer.coupons.map((c) => {
              const exhausted = c.max_uses != null && c.used >= c.max_uses;
              return (
                <tr key={c.id} className="hover:bg-surface-2/50">
                  <Td className="font-mono text-sm">
                    {c.code} {exhausted && <Badge tone="warning">exhausted</Badge>}
                  </Td>
                  <Td className="text-right tabular-nums">{c.used}</Td>
                  <Td className="text-right tabular-nums">{c.max_uses ?? <span className="text-muted">∞</span>}</Td>
                  <Td className="text-right">
                    <Button size="sm" variant="ghost" aria-label={`Delete ${c.code}`} onClick={() => setDeleting(c)}>
                      <Icon name="trash" size={14} className="text-danger" />
                    </Button>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      <ConfirmDialog
        open={deleting != null}
        title="Delete coupon"
        message={`Delete “${deleting?.code ?? ""}”? ${deleting?.used ? `It has been used ${deleting.used} time(s); those redemptions are kept.` : "It has not been used yet."}`}
        loading={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </Modal>
  );
}
