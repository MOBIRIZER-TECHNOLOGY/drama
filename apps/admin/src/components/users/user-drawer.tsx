"use client";

import { useState, type FormEvent } from "react";
import { api, call, type Schemas } from "@/lib/api";
import { useAdmin } from "@/lib/auth";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { useFieldErrors } from "@/lib/forms";
import { useQuery } from "@/lib/use-query";
import { useToast } from "@/components/toast";
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
  Table,
  Td,
  Th,
  statusTone,
} from "@/components/ui";

type User = Schemas["AdminUserOut"];

/** Adjustments beyond this magnitude (or any deduction) need a second look. */
const CONFIRM_DELTA = 1000;

export function UserDrawer({
  user,
  onClose,
  onUpdated,
  onDeleted,
}: {
  user: User;
  onClose: () => void;
  onUpdated: (u: User) => void;
  onDeleted?: (id: string) => void;
}) {
  const admin = useAdmin();
  const toast = useToast();
  const canMoney = admin.role === "owner" || admin.role === "finance";
  const canDelete = admin.role === "owner" && Boolean(onDeleted);

  const [confirmBan, setConfirmBan] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const coins = useFieldErrors<"delta" | "note">();
  const vip = useFieldErrors<"days">();
  const [delta, setDelta] = useState("");
  const [note, setNote] = useState("");
  const [vipDays, setVipDays] = useState("30");
  const [vipNote, setVipNote] = useState("");
  const [pendingCoins, setPendingCoins] = useState<{ delta: number; note: string } | null>(null);
  const [pendingVip, setPendingVip] = useState<{ days: number; note: string | null } | null>(null);

  const ledger = useQuery(`ledger:${user.id}:${user.coin_balance}`, () =>
    call(api.GET("/v1/admin/users/{user_id}/ledger", { params: { path: { user_id: user.id }, query: { limit: 50 } } })),
  );

  async function setStatus(status: Schemas["UserStatus"]) {
    setBusy("status");
    try {
      const updated = await call(api.PUT("/v1/admin/users/{user_id}/status", { params: { path: { user_id: user.id } }, body: { status } }));
      onUpdated(updated);
      toast.success(status === "banned" ? "User banned" : "User reactivated");
      setConfirmBan(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  async function deleteUser() {
    setBusy("delete");
    try {
      await call(api.DELETE("/v1/admin/users/{user_id}", { params: { path: { user_id: user.id } } }));
      toast.success("User deleted");
      setConfirmDelete(false);
      onDeleted?.(user.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  function submitCoins(e: FormEvent) {
    e.preventDefault();
    const d = Number(delta);
    const errors: Partial<Record<"delta" | "note", string>> = {};
    if (delta.trim() === "" || !Number.isInteger(d) || d === 0) errors.delta = "Enter a non-zero whole number.";
    else if (user.coin_balance + d < 0) errors.delta = `That would leave the balance at ${fmtNumber(user.coin_balance + d)}; it cannot go below 0.`;
    if (note.trim().length < 3) errors.note = "Add a note of at least 3 characters for the audit trail.";
    coins.setErrors(errors);
    if (Object.keys(errors).length) return;
    const req = { delta: d, note: note.trim() };
    if (d < 0 || Math.abs(d) > CONFIRM_DELTA) setPendingCoins(req);
    else void applyCoins(req);
  }

  async function applyCoins(req: { delta: number; note: string }) {
    setBusy("coins");
    try {
      const updated = await call(api.POST("/v1/admin/users/{user_id}/coins", { params: { path: { user_id: user.id } }, body: req }));
      onUpdated(updated);
      setDelta("");
      setNote("");
      setPendingCoins(null);
      toast.success(`${req.delta > 0 ? "Granted" : "Removed"} ${fmtNumber(Math.abs(req.delta))} coins; balance is now ${fmtNumber(updated.coin_balance)}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Adjustment failed");
    } finally {
      setBusy(null);
    }
  }

  function submitVip(e: FormEvent) {
    e.preventDefault();
    const days = Number(vipDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      vip.setErrors({ days: "Days must be a whole number between 1 and 3650." });
      return;
    }
    vip.setErrors({});
    setPendingVip({ days, note: vipNote.trim() || null });
  }

  async function applyVip(req: { days: number; note: string | null }) {
    setBusy("vip");
    try {
      await call(api.POST("/v1/admin/users/{user_id}/vip", { params: { path: { user_id: user.id } }, body: req }));
      toast.success(`VIP granted for ${req.days} days`);
      setVipNote("");
      setPendingVip(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "VIP grant failed");
    } finally {
      setBusy(null);
    }
  }

  const vipEnds = pendingVip ? new Date(Date.now() + pendingVip.days * 86400000) : null;

  return (
    <Modal open onClose={onClose} title={user.display_name ?? user.public_id} side>
      <div className="flex flex-col gap-6">
        <section className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Info label="Public ID" value={<span className="font-mono text-xs">{user.public_id}</span>} />
          <Info label="Status" value={<Badge tone={statusTone(user.status)}>{user.status}</Badge>} />
          <Info label="Email" value={user.email ?? "—"} />
          <Info label="Phone" value={user.phone ?? "—"} />
          <Info label="Locale" value={`${user.locale}${user.country ? ` · ${user.country}` : ""}`} />
          <Info label="Referral code" value={user.referral_code ?? "—"} />
          <Info label="Joined" value={fmtDateTime(user.created_at)} />
          <Info label="Last seen" value={fmtDateTime(user.last_seen_at)} />
          <Info label="Coin balance" value={<span className="font-display text-lg font-semibold text-ink">{fmtNumber(user.coin_balance)}</span>} />
        </section>

        <section className="flex flex-wrap gap-2">
          {user.status === "banned" ? (
            <Button loading={busy === "status"} onClick={() => setStatus("active")}>
              Unban user
            </Button>
          ) : user.status === "active" ? (
            <Button variant="danger" loading={busy === "status"} onClick={() => setConfirmBan(true)}>
              Ban user
            </Button>
          ) : (
            <p className="text-xs text-muted">This account is deleted.</p>
          )}
          {canDelete && user.status !== "deleted" && (
            <Button variant="ghost" className="text-danger" onClick={() => setConfirmDelete(true)}>
              Delete user
            </Button>
          )}
        </section>

        {canMoney && (
          <div className="grid gap-4 md:grid-cols-2">
            <form ref={coins.formRef} onSubmit={submitCoins} className="rounded-card border border-line p-4" noValidate>
              <h3 className="mb-3 text-sm font-semibold">Adjust coins</h3>
              <div className="grid gap-3">
                <Field label="Delta" required hint="Negative removes coins." error={coins.errors.delta}>
                  <Input
                    type="number"
                    step={1}
                    value={delta}
                    placeholder="e.g. 100 or -50"
                    onChange={(e) => {
                      setDelta(e.target.value);
                      coins.clearError("delta");
                    }}
                  />
                </Field>
                <Field label="Note" required error={coins.errors.note}>
                  <Input
                    value={note}
                    maxLength={500}
                    placeholder="Why?"
                    onChange={(e) => {
                      setNote(e.target.value);
                      coins.clearError("note");
                    }}
                  />
                </Field>
                <Button type="submit" variant="primary" size="sm" loading={busy === "coins"}>
                  Apply
                </Button>
              </div>
            </form>
            <form ref={vip.formRef} onSubmit={submitVip} className="rounded-card border border-line p-4" noValidate>
              <h3 className="mb-3 text-sm font-semibold">Grant VIP</h3>
              <div className="grid gap-3">
                <Field label="Days" required error={vip.errors.days}>
                  <Input
                    type="number"
                    min={1}
                    max={3650}
                    value={vipDays}
                    onChange={(e) => {
                      setVipDays(e.target.value);
                      vip.clearError("days");
                    }}
                  />
                </Field>
                <Field label="Note">
                  <Input value={vipNote} maxLength={500} placeholder="Optional" onChange={(e) => setVipNote(e.target.value)} />
                </Field>
                <Button type="submit" variant="primary" size="sm" loading={busy === "vip"}>
                  Grant
                </Button>
              </div>
            </form>
          </div>
        )}

        <section>
          <h3 className="mb-2 text-sm font-semibold">Coin ledger</h3>
          <div className="rounded-card border border-line">
            {ledger.error && !ledger.data ? (
              <ErrorState message={ledger.error} onRetry={ledger.refetch} />
            ) : !ledger.data ? (
              <LoadingState />
            ) : ledger.data.length === 0 ? (
              <EmptyState title="No ledger entries" />
            ) : (
              <Table minWidth={460}>
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Kind</Th>
                    <Th className="text-right">Delta</Th>
                    <Th className="text-right">Balance</Th>
                    <Th>Note</Th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.data.map((row) => (
                    <tr key={row.id}>
                      <Td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(row.created_at)}</Td>
                      <Td>
                        <Badge>{row.kind.replace("_", " ")}</Badge>
                      </Td>
                      <Td className={`text-right tabular-nums ${row.delta < 0 ? "text-danger" : "text-success"}`}>
                        {row.delta > 0 ? "+" : ""}
                        {row.delta}
                      </Td>
                      <Td className="text-right tabular-nums">{row.balance_after}</Td>
                      <Td className="max-w-48 truncate text-xs text-ink-2" title={row.note ?? undefined}>
                        {row.note ?? (row.ref_type ? `${row.ref_type} ${row.ref_id ?? ""}` : "—")}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={confirmBan}
        title="Ban user"
        message={`Ban ${user.display_name ?? user.public_id}? They will be signed out and cannot sign in until unbanned.`}
        confirmLabel="Ban"
        loading={busy === "status"}
        onConfirm={() => setStatus("banned")}
        onCancel={() => setConfirmBan(false)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title="Delete user"
        message={`Delete ${user.display_name ?? user.public_id}? Their profile is anonymised and they lose their wallet, history and purchases. This cannot be undone.`}
        loading={busy === "delete"}
        onConfirm={deleteUser}
        onCancel={() => setConfirmDelete(false)}
      />
      <ConfirmDialog
        open={pendingCoins != null}
        title={pendingCoins && pendingCoins.delta < 0 ? "Remove coins" : "Grant a large amount"}
        confirmLabel={pendingCoins && pendingCoins.delta < 0 ? "Remove coins" : "Grant coins"}
        destructive={Boolean(pendingCoins && pendingCoins.delta < 0)}
        loading={busy === "coins"}
        onConfirm={() => pendingCoins && applyCoins(pendingCoins)}
        onCancel={() => setPendingCoins(null)}
        message={
          pendingCoins && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted">User</dt>
              <dd>{user.display_name ?? user.public_id}</dd>
              <dt className="text-muted">Current balance</dt>
              <dd className="tabular-nums">{fmtNumber(user.coin_balance)}</dd>
              <dt className="text-muted">Change</dt>
              <dd className={`tabular-nums ${pendingCoins.delta < 0 ? "text-danger" : "text-success"}`}>
                {pendingCoins.delta > 0 ? "+" : ""}
                {fmtNumber(pendingCoins.delta)}
              </dd>
              <dt className="text-muted">New balance</dt>
              <dd className="font-semibold tabular-nums">{fmtNumber(user.coin_balance + pendingCoins.delta)}</dd>
              <dt className="text-muted">Note</dt>
              <dd>{pendingCoins.note}</dd>
            </dl>
          )
        }
      />
      <ConfirmDialog
        open={pendingVip != null}
        title="Grant VIP"
        confirmLabel="Grant VIP"
        destructive={false}
        loading={busy === "vip"}
        onConfirm={() => pendingVip && applyVip(pendingVip)}
        onCancel={() => setPendingVip(null)}
        message={
          pendingVip && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted">User</dt>
              <dd>{user.display_name ?? user.public_id}</dd>
              <dt className="text-muted">Duration</dt>
              <dd>{pendingVip.days} days</dd>
              <dt className="text-muted">Ends about</dt>
              <dd>{vipEnds ? fmtDateTime(vipEnds.toISOString()) : "—"}</dd>
              <dt className="text-muted">Coin balance</dt>
              <dd className="tabular-nums">{fmtNumber(user.coin_balance)} (unchanged)</dd>
              {pendingVip.note && (
                <>
                  <dt className="text-muted">Note</dt>
                  <dd>{pendingVip.note}</dd>
                </>
              )}
            </dl>
          )
        }
      />
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-0.5 break-words text-ink-2">{value}</p>
    </div>
  );
}
