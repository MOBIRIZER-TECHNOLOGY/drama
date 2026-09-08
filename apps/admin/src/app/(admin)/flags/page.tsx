"use client";

import { useState, type FormEvent } from "react";
import { api, call, type Schemas } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useFieldErrors } from "@/lib/forms";
import { useQuery } from "@/lib/use-query";
import { Icon } from "@/components/icons";
import { formatJson, JsonEditor, parseJsonObject } from "@/components/json-editor";
import { useToast } from "@/components/toast";
import {
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
  Th,
  Toggle,
} from "@/components/ui";

type Flag = Schemas["FlagOut"];

const KEY_RE = /^[a-z0-9_.-]{2,64}$/;
const RULES_HINT = 'Optional targeting, e.g. {"platforms": ["android"], "countries": ["IN"], "min_app_version": 12, "percentage": 50}';

export default function FlagsPage() {
  const toast = useToast();
  const { data, loading, error, refetch, setData } = useQuery("flags", () => call(api.GET("/v1/admin/flags")));
  const [editing, setEditing] = useState<Flag | "new" | null>(null);
  const [deleting, setDeleting] = useState<Flag | null>(null);
  const [busy, setBusy] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const upsert = (saved: Flag) =>
    setData((prev) => {
      const list = prev ?? [];
      return list.some((f) => f.key === saved.key) ? list.map((f) => (f.key === saved.key ? saved : f)) : [...list, saved].sort((a, b) => a.key.localeCompare(b.key));
    });

  async function toggle(f: Flag) {
    const next = { ...f, enabled: !f.enabled };
    setToggling(f.key);
    setData((prev) => (prev ?? []).map((x) => (x.key === f.key ? next : x)));
    try {
      const saved = await call(api.PUT("/v1/admin/flags/{key}", { params: { path: { key: f.key } }, body: { enabled: next.enabled, rules: f.rules } }));
      upsert(saved);
    } catch (e) {
      setData((prev) => (prev ?? []).map((x) => (x.key === f.key ? f : x)));
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setToggling(null);
    }
  }

  async function remove() {
    if (!deleting) return;
    const victim = deleting;
    setBusy(true);
    try {
      await call(api.DELETE("/v1/admin/flags/{key}", { params: { path: { key: victim.key } } }));
      setData((prev) => (prev ?? []).filter((f) => f.key !== victim.key));
      toast.success(`Deleted ${victim.key}`);
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
        title="Feature flags"
        description="Switches the apps read from /config. Rules narrow a flag to platforms, countries, app versions or a percentage rollout."
        actions={
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Icon name="plus" size={15} /> New flag
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
          <EmptyState title="No flags" description="Flags such as rewarded_ads gate features in the apps." />
        ) : (
          <Table minWidth={720}>
            <thead>
              <tr>
                <Th>Key</Th>
                <Th>Enabled</Th>
                <Th>Rules</Th>
                <Th>Updated</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {data.map((f) => (
                <tr key={f.key} className={`hover:bg-surface-2/50 ${loading ? "opacity-70" : ""}`}>
                  <Td className="font-mono text-sm font-medium">{f.key}</Td>
                  <Td>
                    <Toggle label={`${f.key} enabled`} hideLabel checked={f.enabled} disabled={toggling === f.key} onChange={() => toggle(f)} />
                  </Td>
                  <Td>
                    {f.rules && Object.keys(f.rules).length ? (
                      <code className="block max-w-md truncate font-mono text-xs text-ink-2" title={formatJson(f.rules)}>
                        {JSON.stringify(f.rules)}
                      </code>
                    ) : (
                      <span className="text-xs text-muted">everyone</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-muted">
                    {fmtDateTime(f.updated_at)}
                    {/* A flag is a production kill switch. "Who turned this on" used to mean leaving for the
                        audit log, which support and finance roles cannot open at all. */}
                    {f.updated_by && <span className="block text-[11px]">by {f.updated_by}</span>}
                  </Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(f)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" aria-label={`Delete ${f.key}`} onClick={() => setDeleting(f)}>
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
        <FlagDialog
          flag={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            upsert(saved);
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={deleting != null}
        title="Delete flag"
        message={`Delete “${deleting?.key ?? ""}”? Apps fall back to their built-in default for this flag.`}
        loading={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

function FlagDialog({ flag, onClose, onSaved }: { flag: Flag | null; onClose: () => void; onSaved: (f: Flag) => void }) {
  const toast = useToast();
  const [key, setKey] = useState(flag?.key ?? "");
  const [enabled, setEnabled] = useState(flag?.enabled ?? false);
  const [rules, setRules] = useState(flag?.rules ? formatJson(flag.rules) : "");
  const [saving, setSaving] = useState(false);
  const { errors, setErrors, clearError, formRef } = useFieldErrors<"key" | "rules">();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: { key?: string; rules?: string } = {};
    const cleanKey = key.trim();
    if (!KEY_RE.test(cleanKey)) next.key = "2–64 characters: lowercase letters, digits, _ . or -.";
    const parsed = parseJsonObject(rules);
    if (!parsed.ok) next.rules = parsed.error;
    setErrors(next);
    if (Object.keys(next).length || !parsed.ok) return;
    const body = { enabled, rules: Object.keys(parsed.value).length ? parsed.value : null };
    setSaving(true);
    try {
      const saved = await call(api.PUT("/v1/admin/flags/{key}", { params: { path: { key: cleanKey } }, body }));
      toast.success(flag ? "Flag saved" : "Flag created");
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
      title={flag ? `Edit ${flag.key}` : "New flag"}
      width="max-w-lg"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="flag-form" variant="primary" loading={saving}>
            {flag ? "Save" : "Create"}
          </Button>
        </>
      }
    >
      <form id="flag-form" ref={formRef} onSubmit={submit} className="grid gap-4" noValidate>
        <Field label="Key" required error={errors.key} hint="Cannot be changed later; delete and recreate instead.">
          <Input
            data-autofocus
            value={key}
            disabled={flag != null}
            maxLength={64}
            placeholder="rewarded_ads"
            onChange={(e) => {
              setKey(e.target.value.toLowerCase());
              clearError("key");
            }}
            className="font-mono"
          />
        </Field>
        <Toggle label="Enabled" description="Off means the flag is false for everyone regardless of rules." checked={enabled} onChange={setEnabled} />
        <Field label="Rules (JSON)" hint={RULES_HINT} error={errors.rules}>
          <JsonEditor
            value={rules}
            error={errors.rules}
            rows={6}
            placeholder='{"platforms": ["android", "ios"], "percentage": 25}'
            onChange={(t) => {
              setRules(t);
              clearError("rules");
            }}
          />
        </Field>
      </form>
    </Modal>
  );
}
