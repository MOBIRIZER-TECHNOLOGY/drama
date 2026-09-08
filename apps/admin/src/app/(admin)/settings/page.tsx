"use client";

import { useId, useState } from "react";
import { useSaveShortcut, useUnsavedChanges } from "@/lib/editing";
import { useFieldErrors } from "@/lib/forms";
import { coerce, specFor, validate } from "@/lib/settings-schema";
import { api, call } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { JsonEditor } from "@/components/json-editor";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  Select,
  TabPanel,
  Tabs,
} from "@/components/ui";

const NAMESPACES = ["auth", "economy", "rewards", "mobile", "site", "seo", "ads", "payments"] as const;
type Namespace = (typeof NAMESPACES)[number];

const DESCRIPTIONS: Record<Namespace, string> = {
  auth: "Sign-in providers, OTP and session rules.",
  economy: "Coin prices, default episode price, signup bonus.",
  rewards: "Daily check-in ladder and referral bonuses.",
  mobile: "Minimum app versions, force-update messages.",
  site: "Site name, support email, social links.",
  seo: "Default titles, descriptions and social images.",
  ads: "Ad unit IDs and rewarded-ad flags (public IDs only).",
  // The API has always accepted this namespace; the console simply never listed it, so turning a gateway off
  // meant editing the database by hand. Credentials still live in the environment: these are on/off switches.
  payments: "Which checkout gateways are offered. Turning one off hides it from every client.",
};

type Kind = "text" | "json";

/** One value about to change, shown in the save confirmation. */
type Change = { key: string; before: unknown; after: unknown; removed: boolean; sensitive: boolean };
type Row = { id: number; key: string; value: string; kind: Kind };

function looksSecret(key: string): boolean {
  const k = key.toLowerCase();
  return k.includes("secret") || (k.includes("key") && !k.includes("public"));
}

function toRows(data: Record<string, unknown>): Row[] {
  return Object.entries(data).map(([key, v], i) => ({
    id: i + 1,
    key,
    value: typeof v === "string" ? v : JSON.stringify(v),
    kind: typeof v === "string" ? "text" : "json",
  }));
}

export default function SettingsPage() {
  const [ns, setNs] = useState<Namespace>("economy");
  const tabsId = useId();
  return (
    <>
      <PageHeader title="Settings" description="Runtime configuration by namespace. Secrets never go here; they live in the environment." />
      <Tabs id={tabsId} label="Namespace" value={ns} onChange={setNs} tabs={NAMESPACES.map((n) => ({ value: n, label: n }))} />
      <TabPanel tabsId={tabsId} value={ns}>
        <p className="mb-4 mt-3 text-sm text-muted">{DESCRIPTIONS[ns]}</p>
        <NamespaceEditor key={ns} ns={ns} />
      </TabPanel>
    </>
  );
}

function NamespaceEditor({ ns }: { ns: Namespace }) {
  const { data, error, refetch, setData } = useQuery(`settings:${ns}`, () =>
    call(api.GET("/v1/admin/settings/{namespace}", { params: { path: { namespace: ns } } })),
  );
  const [version, setVersion] = useState(0);

  if (error && !data) {
    return (
      <Card>
        <ErrorState message={error} onRetry={refetch} />
      </Card>
    );
  }
  if (!data) {
    return (
      <Card>
        <LoadingState />
      </Card>
    );
  }
  // The row editor seeds its state from `initial`; a new key re-seeds it after each save.
  return (
    <RowsEditor
      key={version}
      ns={ns}
      initial={data as Record<string, unknown>}
      onSaved={(saved) => {
        setData(saved);
        setVersion((v) => v + 1);
      }}
    />
  );
}

function RowsEditor({
  ns,
  initial,
  onSaved,
}: {
  ns: Namespace;
  initial: Record<string, unknown>;
  onSaved: (saved: Record<string, unknown>) => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>(() => toRows(initial));
  const [seq, setSeq] = useState(1000);
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  /** Pending save, held until the operator has seen what is about to change. */
  const [pending, setPending] = useState<{ data: Record<string, unknown>; changes: Change[] } | null>(null);
  const { errors, setErrors, clearError, formRef } = useFieldErrors<string>();

  const update = (id: number, p: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
    clearError(`k${id}`);
    clearError(`v${id}`);
  };
  const remove = (id: number) => setRows((rs) => rs.filter((r) => r.id !== id));
  const add = () => {
    setRows((rs) => [...rs, { id: seq, key: "", value: "", kind: "text" }]);
    setSeq((s) => s + 1);
  };

  const flat = (rs: Row[]) => JSON.stringify(rs.map(({ key, value, kind }) => [key, value, kind]));
  const dirty = flat(rows) !== flat(toRows(initial));
  // Editing a namespace is ten minutes of careful work; a sidebar click used to discard it silently.
  useUnsavedChanges(dirty && !saving, "You have unsaved settings. Leave without saving?");
  useSaveShortcut(review, dirty && !saving);

  /** Validate, coerce to the declared type, and work out what is actually changing. */
  function review() {
    setApiError(null);
    const out: Record<string, unknown> = {};
    const next: Record<string, string> = {};
    for (const r of rows) {
      const key = r.key.trim();
      const spec = specFor(ns, key);
      if (!key) next[`k${r.id}`] = "Key is required.";
      else if (key in out) next[`k${r.id}`] = `Duplicate key “${key}”.`;

      const schemaError = validate(spec, r.value);
      if (schemaError) {
        next[`v${r.id}`] = schemaError;
        continue;
      }
      try {
        // A known key is written as its declared type. Saving the string "50" where the economy expects the
        // number 50 silently changes the type of a live setting.
        out[key] = spec ? coerce(spec, r.value) : r.kind === "json" ? JSON.parse(r.value) : r.value;
      } catch {
        next[`v${r.id}`] = "Not valid JSON.";
      }
    }
    setErrors(next);
    if (Object.keys(next).length) return;

    const changes: Change[] = [];
    for (const key of new Set([...Object.keys(initial), ...Object.keys(out)])) {
      const before = initial[key];
      const after = out[key];
      const removed = !(key in out);
      if (!removed && JSON.stringify(before) === JSON.stringify(after)) continue;
      changes.push({ key, before, after, removed, sensitive: Boolean(specFor(ns, key)?.sensitive) });
    }
    if (changes.length === 0) {
      toast.success("Nothing to save");
      return;
    }
    setPending({ data: out, changes });
  }

  async function commit() {
    if (!pending) return;
    setSaving(true);
    try {
      const saved = await call(
        api.PUT("/v1/admin/settings/{namespace}", { params: { path: { namespace: ns } }, body: { data: pending.data } }),
      );
      toast.success(`Saved ${ns} settings`);
      setPending(null);
      onSaved(saved as Record<string, unknown>);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setApiError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title={`${ns} (${rows.length} ${rows.length === 1 ? "key" : "keys"})`}
      actions={
        <div className="flex gap-2">
          <Button size="sm" onClick={add}>
            <Icon name="plus" size={13} /> Add key
          </Button>
          <Button size="sm" variant="primary" onClick={review} loading={saving} disabled={!dirty}>
            Review and save
          </Button>
        </div>
      }
    >
      {apiError && (
        <p role="alert" className="mx-4 mt-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {apiError}
        </p>
      )}
      {rows.length === 0 ? (
        <EmptyState title="No keys" description="Add a key to start configuring this namespace." action={<Button size="sm" onClick={add}>Add key</Button>} />
      ) : (
        <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="scroll-x" noValidate>
          <table className="w-full text-sm" style={{ minWidth: 640 }}>
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-2">Key</th>
                <th className="px-2 py-2">Type</th>
                <th className="px-2 py-2">Value</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const secret = looksSecret(r.key);
                const spec = specFor(ns, r.key.trim());
                const keyError = errors[`k${r.id}`];
                const valueError = errors[`v${r.id}`];
                return (
                  <tr key={r.id} className="border-t border-line align-top">
                    <td className="w-64 px-4 py-2">
                      <Input
                        aria-label="Key"
                        value={r.key}
                        onChange={(e) => update(r.id, { key: e.target.value })}
                        className={`h-9 font-mono text-xs ${secret ? "border-danger" : ""}`}
                        aria-invalid={secret || Boolean(keyError) || undefined}
                      />
                      {keyError ? (
                        <p role="alert" className="mt-1 text-[11px] text-danger">
                          {keyError}
                        </p>
                      ) : secret ? (
                        <p className="mt-1 text-[11px] text-danger">Looks like a secret; the API will reject it.</p>
                      ) : spec ? (
                        <p className="mt-1 text-[11px] text-muted">
                          <span className="font-medium text-ink-2">{spec.label}.</span> {spec.description}
                        </p>
                      ) : (
                        <p className="mt-1 text-[11px] text-muted">Custom key — no schema, so no validation.</p>
                      )}
                    </td>
                    <td className="w-28 px-2 py-2">
                      <Select aria-label="Value type" value={r.kind} onChange={(e) => update(r.id, { kind: e.target.value as Kind })} className="h-9 text-xs">
                        <option value="text">text</option>
                        <option value="json">JSON</option>
                      </Select>
                    </td>
                    <td className="px-2 py-2">
                      {spec?.kind === "boolean" ? (
                        <Select
                          aria-label="Value"
                          value={r.value.trim() === "true" ? "true" : "false"}
                          onChange={(e) => update(r.id, { value: e.target.value })}
                          className="h-9 w-28 text-xs"
                        >
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </Select>
                      ) : spec?.kind === "json" || (!spec && r.kind === "json") ? (
                        // The project has a JSON editor; a nested object in an h-9 input cannot be read or edited.
                        <JsonEditor value={r.value} onChange={(v) => update(r.id, { value: v })} rows={4} />
                      ) : (
                        <div className="flex items-center gap-2">
                          <Input
                            aria-label="Value"
                            inputMode={spec?.kind === "number" ? "decimal" : undefined}
                            value={r.value}
                            onChange={(e) => update(r.id, { value: e.target.value })}
                            className="h-9"
                            aria-invalid={Boolean(valueError) || undefined}
                          />
                          {spec?.unit && <span className="shrink-0 text-xs text-muted">{spec.unit}</span>}
                        </div>
                      )}
                      {valueError && (
                        <p role="alert" className="mt-1 text-[11px] text-danger">
                          {valueError}
                        </p>
                      )}
                    </td>
                    <td className="w-12 px-2 py-2 text-right">
                      <Button size="sm" variant="ghost" aria-label={`Remove ${r.key || "row"}`} onClick={() => remove(r.id)}>
                        <Icon name="trash" size={14} className="text-danger" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </form>
      )}

      <ConfirmDialog
        open={pending != null}
        title={`Save ${ns} settings`}
        confirmLabel="Save changes"
        loading={saving}
        onCancel={() => setPending(null)}
        onConfirm={() => void commit()}
        message={
          pending ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-ink-2">
                {pending.changes.length} value{pending.changes.length === 1 ? "" : "s"} will change. This is live
                configuration and takes effect immediately.
              </p>
              <ul className="flex flex-col gap-2 text-sm">
                {pending.changes.map((c) => (
                  <li key={c.key} className="rounded-lg border border-line px-3 py-2">
                    <p className="font-mono text-xs text-ink">
                      {c.key}
                      {c.sensitive && <span className="ml-2 rounded bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold text-danger">SENSITIVE</span>}
                    </p>
                    <p className="mt-1 break-all text-xs text-muted">
                      <span className="line-through">{JSON.stringify(c.before) ?? "unset"}</span>
                      {" → "}
                      <span className="font-medium text-ink">{c.removed ? "removed" : JSON.stringify(c.after)}</span>
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            ""
          )
        }
      />
    </Card>
  );
}
