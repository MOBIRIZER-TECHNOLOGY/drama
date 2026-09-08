"use client";

import { useState, type FormEvent } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, call, type Schemas } from "@/lib/api";
import { fmtDateTime, fmtMoney, fmtNumber } from "@/lib/format";
import { useFieldErrors } from "@/lib/forms";
import { useQuery } from "@/lib/use-query";
import { Icon } from "@/components/icons";
import { formatJson, JsonEditor, parseJsonObject, type JsonObject } from "@/components/json-editor";
import { useToast } from "@/components/toast";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  InlineError,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  Table,
  Td,
  Textarea,
  Th,
} from "@/components/ui";

type Experiment = Schemas["ExperimentOut"];
type ExperimentIn = Schemas["ExperimentIn"];
type VariantResult = Schemas["VariantResult"];

const KEY_RE = /^[a-z0-9_]{3,64}$/;

function experimentTone(status: string) {
  if (status === "running") return "success" as const;
  if (status === "ended") return "neutral" as const;
  return "warning" as const;
}

export default function ExperimentsPage() {
  const toast = useToast();
  const { data, loading, error, refetch, setData } = useQuery("experiments", () => call(api.GET("/v1/admin/experiments")));
  const [editing, setEditing] = useState<Experiment | "new" | null>(null);
  const [results, setResults] = useState<Experiment | null>(null);
  const [confirm, setConfirm] = useState<{ exp: Experiment; action: "start" | "stop" } | null>(null);
  const [busy, setBusy] = useState(false);

  const upsert = (saved: Experiment) =>
    setData((prev) => {
      const list = prev ?? [];
      return list.some((e) => e.key === saved.key) ? list.map((e) => (e.key === saved.key ? saved : e)) : [...list, saved].sort((a, b) => a.key.localeCompare(b.key));
    });

  async function runAction() {
    if (!confirm) return;
    const { exp, action } = confirm;
    setBusy(true);
    try {
      const saved =
        action === "start"
          ? await call(api.POST("/v1/admin/experiments/{key}/start", { params: { path: { key: exp.key } } }))
          : await call(api.POST("/v1/admin/experiments/{key}/stop", { params: { path: { key: exp.key } } }));
      upsert(saved);
      toast.success(action === "start" ? `${exp.key} is running` : `${exp.key} stopped`);
      setConfirm(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Experiments"
        description="A/B tests: viewers are bucketed into variants by allocation; unlocks and purchases record the variant they saw."
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Icon name="plus" size={15} /> New experiment
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
          <EmptyState
            title="No experiments"
            description="Create one with at least two variants and an allocation that sums to 100."
            action={
              <Button variant="primary" onClick={() => setEditing("new")}>
                New experiment
              </Button>
            }
          />
        ) : (
          <Table minWidth={860}>
            <thead>
              <tr>
                <Th>Key</Th>
                <Th>Status</Th>
                <Th>Variants</Th>
                <Th>Started</Th>
                <Th>Ended</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {data.map((e) => {
                const variants = Object.keys(e.variants);
                return (
                  <tr key={e.key} className={`hover:bg-surface-2/50 ${loading ? "opacity-70" : ""}`}>
                    <Td>
                      <span className="block font-mono text-sm font-medium">{e.key}</span>
                      {e.description && <span className="block max-w-md truncate text-xs text-muted">{e.description}</span>}
                    </Td>
                    <Td>
                      <Badge tone={experimentTone(e.status)}>{e.status}</Badge>
                    </Td>
                    <Td>
                      <span className="flex flex-wrap gap-1">
                        {variants.map((v) => (
                          <span key={v} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">
                            {v} {typeof e.allocation[v] === "number" ? `${e.allocation[v]}%` : ""}
                          </span>
                        ))}
                      </span>
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(e.started_at)}</Td>
                    <Td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(e.ended_at)}</Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setResults(e)}>
                          <Icon name="chart" size={14} /> Results
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(e)}>
                          Edit
                        </Button>
                        {e.status === "running" ? (
                          <Button size="sm" onClick={() => setConfirm({ exp: e, action: "stop" })}>
                            <Icon name="stop" size={13} /> Stop
                          </Button>
                        ) : (
                          <Button size="sm" variant="primary" onClick={() => setConfirm({ exp: e, action: "start" })}>
                            <Icon name="play" size={13} /> {e.status === "ended" ? "Restart" : "Start"}
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
        <ExperimentDialog
          experiment={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            upsert(saved);
            setEditing(null);
          }}
        />
      )}

      {results && <ResultsDialog experiment={results} onClose={() => setResults(null)} />}

      <ConfirmDialog
        open={confirm != null}
        title={confirm?.action === "start" ? "Start experiment" : "Stop experiment"}
        message={
          confirm?.action === "start"
            ? `Start “${confirm.exp.key}”? New viewers will be assigned to variants from now on${confirm.exp.status === "ended" ? " and the previous end date is cleared" : ""}.`
            : `Stop “${confirm?.exp.key}”? Assignments stop and results are frozen at this point. You can start it again later.`
        }
        confirmLabel={confirm?.action === "start" ? "Start" : "Stop"}
        destructive={confirm?.action === "stop"}
        loading={busy}
        onConfirm={runAction}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}

/* ---------- create / edit ---------- */

type VariantRow = { id: number; name: string; config: string; allocation: string };
type ErrKey = "key" | "variants";

let rowSeq = 0;
const newRow = (name = "", config = "{}", allocation = ""): VariantRow => ({ id: ++rowSeq, name, config, allocation });

function ExperimentDialog({
  experiment,
  onClose,
  onSaved,
}: {
  experiment: Experiment | null;
  onClose: () => void;
  onSaved: (e: Experiment) => void;
}) {
  const toast = useToast();
  const locked = experiment != null && experiment.started_at != null; // variant set cannot change once started
  const [key, setKey] = useState(experiment?.key ?? "");
  const [description, setDescription] = useState(experiment?.description ?? "");
  const [rows, setRows] = useState<VariantRow[]>(() => {
    if (!experiment) return [newRow("control", "{}", "50"), newRow("treatment", "{}", "50")];
    return Object.entries(experiment.variants).map(([name, cfg]) => {
      const alloc = experiment.allocation[name];
      return newRow(name, formatJson(cfg ?? {}) || "{}", typeof alloc === "number" ? String(alloc) : "");
    });
  });
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const { errors, setErrors, clearError, formRef } = useFieldErrors<ErrKey>();

  const total = rows.reduce((sum, r) => sum + (Number.isFinite(Number(r.allocation)) ? Number(r.allocation) : 0), 0);
  const setRow = (id: number, p: Partial<VariantRow>) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
    setRowErrors((e) => {
      if (!(id in e)) return e;
      const copy = { ...e };
      delete copy[id];
      return copy;
    });
    clearError("variants");
  };

  function splitEvenly() {
    const n = rows.length;
    if (!n) return;
    const base = Math.floor(100 / n);
    const rem = 100 - base * n;
    setRows((rs) => rs.map((r, i) => ({ ...r, allocation: String(base + (i < rem ? 1 : 0)) })));
    clearError("variants");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: Partial<Record<ErrKey, string>> = {};
    const perRow: Record<number, string> = {};
    const cleanKey = key.trim();
    if (!KEY_RE.test(cleanKey)) next.key = "3–64 characters: lowercase letters, digits and underscores.";

    const variants: Record<string, JsonObject> = {};
    const allocation: Record<string, number> = {};
    for (const r of rows) {
      const name = r.name.trim();
      if (!name) {
        perRow[r.id] = "Variant name is required.";
        continue;
      }
      if (!/^[a-z0-9_-]{1,40}$/i.test(name)) {
        perRow[r.id] = "Use letters, digits, _ or - (max 40).";
        continue;
      }
      if (name in variants) {
        perRow[r.id] = `Duplicate variant “${name}”.`;
        continue;
      }
      const parsed = parseJsonObject(r.config);
      if (!parsed.ok) {
        perRow[r.id] = parsed.error;
        continue;
      }
      const pct = Number(r.allocation);
      if (r.allocation.trim() === "" || !Number.isInteger(pct) || pct < 0 || pct > 100) {
        perRow[r.id] = "Allocation must be a whole number from 0 to 100.";
        continue;
      }
      variants[name] = parsed.value;
      allocation[name] = pct;
    }
    if (Object.keys(perRow).length === 0) {
      if (rows.length < 2) next.variants = "At least two variants are required.";
      else if (total !== 100) next.variants = `Allocation must sum to 100 (currently ${total}).`;
    } else {
      next.variants = "Fix the highlighted variants.";
    }
    setRowErrors(perRow);
    setErrors(next);
    if (Object.keys(next).length) return;

    const body: ExperimentIn = { key: cleanKey, description: description.trim() || null, variants, allocation };
    setSaving(true);
    try {
      const saved = experiment
        ? await call(api.PUT("/v1/admin/experiments/{key}", { params: { path: { key: experiment.key } }, body }))
        : await call(api.POST("/v1/admin/experiments", { body }));
      toast.success(experiment ? "Experiment saved" : "Experiment created");
      onSaved(saved);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      if (/key/i.test(msg) && !experiment) setErrors({ key: msg });
      else toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!saving}
      title={experiment ? `Edit ${experiment.key}` : "New experiment"}
      width="max-w-3xl"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="experiment-form" variant="primary" loading={saving}>
            {experiment ? "Save" : "Create"}
          </Button>
        </>
      }
    >
      <form id="experiment-form" ref={formRef} onSubmit={submit} className="grid gap-4" noValidate>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Key" required hint="Stable identifier the apps read from /config." error={errors.key}>
            <Input
              data-autofocus
              value={key}
              disabled={experiment != null}
              maxLength={64}
              placeholder="paywall_copy_v2"
              onChange={(e) => {
                setKey(e.target.value.toLowerCase());
                clearError("key");
              }}
              className="font-mono"
            />
          </Field>
          <Field label="Description">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-10" rows={2} />
          </Field>
        </div>

        <fieldset>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <legend className="text-[13px] font-medium text-ink-2">
              Variants <span className="text-muted">({rows.length})</span>
            </legend>
            <div className="flex items-center gap-2">
              <span className={`text-xs tabular-nums ${total === 100 ? "text-success" : "text-warning"}`}>Total {total}%</span>
              <Button size="sm" variant="ghost" onClick={splitEvenly}>
                Split evenly
              </Button>
              <Button size="sm" disabled={locked} onClick={() => setRows((rs) => [...rs, newRow()])}>
                <Icon name="plus" size={13} /> Add variant
              </Button>
            </div>
          </div>
          {locked && <p className="mb-2 text-xs text-muted">This experiment has started: variant names cannot change, but their config and allocation can.</p>}
          <div className="grid gap-3">
            {rows.map((r) => (
              <div key={r.id} className={`rounded-lg border p-3 ${rowErrors[r.id] ? "border-danger" : "border-line"}`}>
                <div className="grid gap-3 md:grid-cols-[1fr_120px_auto]">
                  <Field label="Name">
                    <Input
                      value={r.name}
                      disabled={locked}
                      aria-invalid={rowErrors[r.id] ? true : undefined}
                      placeholder="control"
                      onChange={(e) => setRow(r.id, { name: e.target.value })}
                      className="font-mono"
                    />
                  </Field>
                  <Field label="Allocation %">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={r.allocation}
                      onChange={(e) => setRow(r.id, { allocation: e.target.value })}
                    />
                  </Field>
                  <div className="flex items-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={locked || rows.length <= 2}
                      aria-label={`Remove variant ${r.name || ""}`}
                      onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                    >
                      <Icon name="trash" size={14} className="text-danger" />
                    </Button>
                  </div>
                </div>
                <Field label="Config (JSON)" className="mt-3" hint="Sent to the apps as the variant payload.">
                  <JsonEditor value={r.config} rows={3} onChange={(text) => setRow(r.id, { config: text })} />
                </Field>
                {rowErrors[r.id] && (
                  <p role="alert" className="mt-2 text-xs text-danger">
                    {rowErrors[r.id]}
                  </p>
                )}
              </div>
            ))}
          </div>
          {errors.variants && (
            <p role="alert" className="mt-2 text-xs text-danger">
              {errors.variants}
            </p>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}

/* ---------- results ---------- */

function ResultsDialog({ experiment, onClose }: { experiment: Experiment; onClose: () => void }) {
  const { data, error, refetch } = useQuery(`experiment-results:${experiment.key}`, () =>
    call(api.GET("/v1/admin/experiments/{key}/results", { params: { path: { key: experiment.key } } })),
  );
  const currencies = [...new Set((data ?? []).flatMap((r) => Object.keys(r.revenue)))].sort();
  const chart = (data ?? []).map((r) => ({ variant: r.variant, users: r.users, unlocks: r.unlocks, purchases: r.purchases }));

  return (
    <Modal
      open
      onClose={onClose}
      title={`Results · ${experiment.key}`}
      width="max-w-4xl"
      footer={
        <Button onClick={onClose} data-autofocus>
          Close
        </Button>
      }
    >
      <p className="mb-4 text-sm text-muted">
        <Badge tone={experimentTone(experiment.status)}>{experiment.status}</Badge>
        <span className="ml-2">
          {experiment.started_at ? `since ${fmtDateTime(experiment.started_at)}` : "not started: counts include all assignments"}
          {experiment.ended_at ? ` · ended ${fmtDateTime(experiment.ended_at)}` : ""}
        </span>
      </p>
      {error && !data ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : !data ? (
        <LoadingState />
      ) : data.length === 0 ? (
        <EmptyState title="No variants" />
      ) : (
        <div className="flex flex-col gap-5">
          <Table minWidth={720}>
            <thead>
              <tr>
                <Th>Variant</Th>
                <Th className="text-right">Users</Th>
                <Th className="text-right">Unlocks</Th>
                <Th className="text-right">Unlock rate</Th>
                <Th className="text-right">Purchasers</Th>
                <Th className="text-right">Conversion</Th>
                <Th>Verdict</Th>
                <Th className="text-right">Purchases</Th>
                <Th className="text-right">Revenue</Th>
                <Th className="text-right">Coins spent</Th>
              </tr>
            </thead>
            <tbody>
              {data.map((r: VariantResult) => (
                <tr key={r.variant}>
                  <Td className="font-mono text-sm font-medium">
                    {r.variant}
                    {r.is_control && <span className="ml-2 text-[11px] font-normal text-muted">control</span>}
                  </Td>
                  <Td className="text-right tabular-nums">{fmtNumber(r.users)}</Td>
                  <Td className="text-right tabular-nums">{fmtNumber(r.unlocks)}</Td>
                  <Td className="text-right tabular-nums">{(r.unlock_rate * 100).toFixed(1)}%</Td>
                  <Td className="text-right tabular-nums">{fmtNumber(r.purchasers)}</Td>
                  <Td className="text-right tabular-nums">{(r.conversion * 100).toFixed(2)}%</Td>
                  <Td>
                    <Verdict row={r} />
                  </Td>
                  <Td className="text-right tabular-nums">{fmtNumber(r.purchases)}</Td>
                  <Td className="text-right tabular-nums">
                    {currencies.length === 0 ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span className="flex flex-col items-end">
                        {currencies.map((c) => (
                          <span key={c}>{fmtMoney(r.revenue[c] ?? 0, c)}</span>
                        ))}
                      </span>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{fmtNumber(r.coins_spent)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--line)" vertical={false} />
                <XAxis dataKey="variant" tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid var(--line)", fontSize: 12 }} cursor={{ fill: "var(--surface-2)" }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="users" name="Users" fill="var(--muted)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="unlocks" name="Unlocks" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="purchases" name="Purchases" fill="var(--gold)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * Whether a difference is real, rather than two percentages side by side.
 *
 * The table showed conversion per variant and left the reader to eyeball it, which reliably declares a winner
 * on a hundred users and ships a price change on noise. The server runs a two-proportion z-test against the
 * control and reports the p-value; the line drawn at 0.05 is stated on screen rather than implied.
 */
function Verdict({ row }: { row: VariantResult }) {
  if (row.is_control) return <span className="text-xs text-muted">baseline</span>;

  if (row.note) {
    return (
      <span className="block max-w-[16rem] text-xs text-muted" title={row.note}>
        {row.note}
      </span>
    );
  }
  if (row.p_value == null) return <span className="text-xs text-muted">—</span>;

  const lift = row.lift_pct;
  const better = (lift ?? 0) >= 0;
  return (
    <span className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1.5">
        <Badge tone={row.significant ? (better ? "success" : "danger") : "neutral"}>
          {row.significant ? (better ? "winning" : "losing") : "no call yet"}
        </Badge>
        {lift != null && (
          <span className={`text-xs tabular-nums ${row.significant ? (better ? "text-success" : "text-danger") : "text-muted"}`}>
            {better ? "+" : ""}
            {lift.toFixed(1)}%
          </span>
        )}
      </span>
      <span className="text-[11px] text-muted" title="Two-proportion z-test against the control">
        p = {row.p_value < 0.001 ? "<0.001" : row.p_value.toFixed(3)}
        {row.significant ? "" : " (needs < 0.05)"}
      </span>
    </span>
  );
}
