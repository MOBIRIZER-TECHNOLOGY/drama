"use client";

import { useId, useState } from "react";
import { useFieldErrors } from "@/lib/forms";
import { api, call } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { Button, Card, EmptyState, ErrorState, Input, LoadingState, PageHeader, Select, TabPanel, Tabs } from "@/components/ui";

const NAMESPACES = ["auth", "economy", "rewards", "mobile", "site", "seo", "ads"] as const;
type Namespace = (typeof NAMESPACES)[number];

const DESCRIPTIONS: Record<Namespace, string> = {
  auth: "Sign-in providers, OTP and session rules.",
  economy: "Coin prices, default episode price, signup bonus.",
  rewards: "Daily check-in ladder and referral bonuses.",
  mobile: "Minimum app versions, force-update messages.",
  site: "Site name, support email, social links.",
  seo: "Default titles, descriptions and social images.",
  ads: "Ad unit IDs and rewarded-ad flags (public IDs only).",
};

type Kind = "text" | "json";
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

  async function save() {
    setApiError(null);
    const out: Record<string, unknown> = {};
    const next: Record<string, string> = {};
    for (const r of rows) {
      const key = r.key.trim();
      if (!key) next[`k${r.id}`] = "Key is required.";
      else if (key in out) next[`k${r.id}`] = `Duplicate key “${key}”.`;
      if (r.kind === "json") {
        try {
          out[key] = JSON.parse(r.value);
        } catch {
          next[`v${r.id}`] = "Not valid JSON.";
        }
      } else {
        out[key] = r.value;
      }
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      const saved = await call(api.PUT("/v1/admin/settings/{namespace}", { params: { path: { namespace: ns } }, body: { data: out } }));
      toast.success(`Saved ${ns} settings`);
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
          <Button size="sm" variant="primary" onClick={save} loading={saving} disabled={!dirty}>
            Save
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
                      ) : null}
                    </td>
                    <td className="w-28 px-2 py-2">
                      <Select aria-label="Value type" value={r.kind} onChange={(e) => update(r.id, { kind: e.target.value as Kind })} className="h-9 text-xs">
                        <option value="text">text</option>
                        <option value="json">JSON</option>
                      </Select>
                    </td>
                    <td className="px-2 py-2">
                      <Input
                        aria-label="Value"
                        value={r.value}
                        onChange={(e) => update(r.id, { value: e.target.value })}
                        className={`h-9 ${r.kind === "json" ? "font-mono text-xs" : ""}`}
                        placeholder={r.kind === "json" ? 'e.g. 12, true, ["a","b"]' : ""}
                        aria-invalid={Boolean(valueError) || undefined}
                      />
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
    </Card>
  );
}
