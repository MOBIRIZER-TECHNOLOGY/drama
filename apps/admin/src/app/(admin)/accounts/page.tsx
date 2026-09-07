"use client";

import { useState, type FormEvent } from "react";
import { api, call, type Schemas } from "@/lib/api";
import { useAdmin } from "@/lib/auth";
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

type Account = Schemas["AdminAccountOut"];
type Role = Schemas["AdminRole"];
const ROLES: Role[] = ["owner", "editor", "support", "finance"];

const ROLE_HELP: Record<Role, string> = {
  owner: "Everything, including admin accounts.",
  editor: "Dramas, categories, languages, pages.",
  support: "Users, reports, inbox.",
  finance: "Packs, purchases, users (coins/VIP), settings.",
};

export default function AccountsPage() {
  const me = useAdmin();
  const toast = useToast();
  const { data, loading, error, refetch, setData } = useQuery("accounts", () => call(api.GET("/v1/admin/accounts")));
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [disabling, setDisabling] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  const [enabling, setEnabling] = useState<string | null>(null);

  function replace(saved: Account) {
    setData((prev) => (prev ?? []).map((a) => (a.id === saved.id ? saved : a)));
  }

  async function enable(a: Account) {
    setEnabling(a.id);
    try {
      const saved = await call(
        api.PUT("/v1/admin/accounts/{account_id}", { params: { path: { account_id: a.id } }, body: { is_active: true } }),
      );
      replace(saved);
      toast.success(`Re-enabled ${saved.email}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Enable failed");
    } finally {
      setEnabling(null);
    }
  }

  async function disable() {
    if (!disabling) return;
    setBusy(true);
    const victim = disabling;
    try {
      await call(api.DELETE("/v1/admin/accounts/{account_id}", { params: { path: { account_id: victim.id } } }));
      setData((prev) => (prev ?? []).map((a) => (a.id === victim.id ? { ...a, is_active: false } : a)));
      toast.success(`Disabled ${victim.email}`);
      setDisabling(null);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Disable failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Admin accounts"
        description="Who can sign in here, and what they can do."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={15} /> New account
          </Button>
        }
      />
      <Card>
        {error && !data ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : !data ? (
          <LoadingState />
        ) : data.length === 0 ? (
          <EmptyState title="No accounts" />
        ) : (
          <Table minWidth={680}>
            <thead>
              <tr>
                <Th>Account</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th>Last login</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id} className={`hover:bg-surface-2/50 ${loading ? "opacity-70" : ""}`}>
                  <Td>
                    <span className="block font-medium">
                      {a.display_name}
                      {a.id === me.id && <span className="ml-2 text-xs text-muted">(you)</span>}
                    </span>
                    <span className="text-xs text-muted">{a.email}</span>
                  </Td>
                  <Td>
                    <Badge tone={a.role === "owner" ? "gold" : "neutral"}>{a.role}</Badge>
                  </Td>
                  <Td>{a.is_active ? <Badge tone="success">active</Badge> : <Badge tone="danger">disabled</Badge>}</Td>
                  <Td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(a.last_login_at)}</Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>
                        Edit
                      </Button>
                      {a.id !== me.id &&
                        (a.is_active ? (
                          <Button size="sm" variant="ghost" onClick={() => setDisabling(a)}>
                            Disable
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" loading={enabling === a.id} onClick={() => enable(a)}>
                            Enable
                          </Button>
                        ))}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {creating && (
        <CreateDialog
          onClose={() => setCreating(false)}
          onSaved={(saved) => {
            setData((prev) => [...(prev ?? []), saved]);
            setCreating(false);
          }}
        />
      )}

      {editing && (
        <EditDialog
          account={editing}
          isSelf={editing.id === me.id}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            replace(saved);
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={disabling != null}
        title="Disable account"
        message={`Disable ${disabling?.email ?? ""}? They will be signed out and cannot sign in again until re-enabled.`}
        confirmLabel="Disable"
        loading={busy}
        onConfirm={disable}
        onCancel={() => setDisabling(null)}
      />
    </>
  );
}

function CreateDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (a: Account) => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ email: "", display_name: "", password: "", role: "editor" as Role });
  const [saving, setSaving] = useState(false);
  const { errors, setErrors, clearError, formRef } = useFieldErrors<"email" | "display_name" | "password">();
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (k === "email" || k === "display_name" || k === "password") clearError(k);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: Partial<Record<"email" | "display_name" | "password", string>> = {};
    if (!form.display_name.trim()) next.display_name = "Name is required.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = "Enter a valid email address.";
    if (form.password.length < 10) next.password = "Password must be at least 10 characters.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setSaving(true);
    try {
      const saved = await call(
        api.POST("/v1/admin/accounts", {
          body: { email: form.email.trim().toLowerCase(), display_name: form.display_name.trim(), password: form.password, role: form.role },
        }),
      );
      toast.success(`Created ${saved.email}`);
      onSaved(saved);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New admin account"
      width="max-w-md"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="account-form" variant="primary" loading={saving}>
            Create
          </Button>
        </>
      }
    >
      <form id="account-form" ref={formRef} onSubmit={submit} className="grid gap-4" noValidate autoComplete="off">
        <Field label="Display name" required error={errors.display_name}>
          <Input data-autofocus value={form.display_name} maxLength={120} onChange={(e) => set("display_name", e.target.value)} />
        </Field>
        <Field label="Email" required error={errors.email}>
          <Input type="email" value={form.email} autoComplete="off" onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label="Password" required hint="At least 10 characters. Share it out of band." error={errors.password}>
          <Input type="password" value={form.password} autoComplete="new-password" minLength={10} onChange={(e) => set("password", e.target.value)} />
        </Field>
        <Field label="Role" hint={ROLE_HELP[form.role]}>
          <Select value={form.role} onChange={(e) => set("role", e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
      </form>
    </Modal>
  );
}

function EditDialog({
  account,
  isSelf,
  onClose,
  onSaved,
}: {
  account: Account;
  isSelf: boolean;
  onClose: () => void;
  onSaved: (a: Account) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    display_name: account.display_name,
    role: account.role,
    is_active: account.is_active,
    password: "",
  });
  const [saving, setSaving] = useState(false);
  const { errors, setErrors, clearError, formRef } = useFieldErrors<"display_name" | "password">();
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (k === "display_name" || k === "password") clearError(k);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    const display_name = form.display_name.trim();
    const next: Partial<Record<"display_name" | "password", string>> = {};
    if (!display_name) next.display_name = "Name is required.";
    if (form.password && form.password.length < 10) next.password = "New password must be at least 10 characters.";
    setErrors(next);
    if (Object.keys(next).length) return;
    const body: Schemas["AdminAccountUpdateIn"] = { display_name };
    if (!isSelf) {
      body.role = form.role;
      body.is_active = form.is_active;
    }
    if (form.password) body.password = form.password;
    setSaving(true);
    try {
      const saved = await call(api.PUT("/v1/admin/accounts/{account_id}", { params: { path: { account_id: account.id } }, body }));
      toast.success(form.password ? "Account saved; password reset" : "Account saved");
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
      title={`Edit ${account.email}`}
      width="max-w-md"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="edit-account-form" variant="primary" loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <form id="edit-account-form" ref={formRef} onSubmit={submit} className="grid gap-4" noValidate autoComplete="off">
        <Field label="Display name" required error={errors.display_name}>
          <Input data-autofocus value={form.display_name} maxLength={120} onChange={(e) => set("display_name", e.target.value)} />
        </Field>
        <Field label="Role" hint={isSelf ? "You cannot change your own role." : ROLE_HELP[form.role]}>
          <Select value={form.role} disabled={isSelf} onChange={(e) => set("role", e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </Field>
        <Toggle
          label="Active"
          description={isSelf ? "You cannot disable your own account." : "Inactive accounts cannot sign in."}
          checked={form.is_active}
          disabled={isSelf}
          onChange={(v) => set("is_active", v)}
        />
        <Field label="New password" hint="Leave blank to keep the current password. At least 10 characters." error={errors.password}>
          <Input type="password" value={form.password} autoComplete="new-password" minLength={10} onChange={(e) => set("password", e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}
