"use client";

import { useState } from "react";
import { api, call } from "@/lib/api";
import { downloadCsv } from "@/lib/editing";
import { fmtDateTime } from "@/lib/format";
import { useQuery } from "@/lib/use-query";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  InlineError,
  LoadingState,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Table,
  Td,
  Th,
} from "@/components/ui";

/** The actions worth filtering to. Anything else still appears under "All actions". */
const ACTIONS = [
  { value: "user.status", label: "Ban / unban" },
  { value: "user.coins", label: "Coin adjustment" },
  { value: "user.vip_grant", label: "VIP grant" },
  { value: "user.delete", label: "Account deletion" },
  { value: "flag.set", label: "Feature flag change" },
  { value: "flag.delete", label: "Feature flag deleted" },
  { value: "settings.save", label: "Settings save" },
];

/**
 * The audit trail.
 *
 * Until now the coin ledger was the only thing in the product that remembered anything: who banned an account,
 * who cleared a moderation flag, who changed the price of an episode and who flipped a production kill switch
 * were all unanswerable after the fact. That is the record a takedown dispute or a post-incident review is made
 * of.
 */
export default function AuditPage() {
  const [action, setAction] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(50);

  const { data, loading, error, refetch } = useQuery(`audit:${action}:${offset}:${limit}`, async () => {
    const rows = await call(
      api.GET("/v1/admin/audit", { params: { query: { action: action || undefined, limit: limit + 1, offset } } }),
    );
    return { items: rows.slice(0, limit), hasNext: rows.length > limit };
  });

  const q = query.trim().toLowerCase();
  const rows = (data?.items ?? []).filter(
    (r) => !q || `${r.admin_email ?? ""} ${r.action} ${r.target_type ?? ""} ${r.target_id ?? ""} ${r.note ?? ""}`.toLowerCase().includes(q),
  );

  /** Compact one-line summary of what changed, so the table stays readable without opening every row. */
  const summarise = (before: unknown, after: unknown): string => {
    const a = (after ?? {}) as Record<string, unknown>;
    const b = (before ?? {}) as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
    if (keys.length === 0) return "—";
    return keys
      .slice(0, 3)
      .map((k) => (k in b ? `${k}: ${JSON.stringify(b[k])} → ${JSON.stringify(a[k])}` : `${k}: ${JSON.stringify(a[k])}`))
      .join(", ");
  };

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every privilege change, ban, price edit and settings save, most recent first."
        actions={
          <Button
            size="sm"
            disabled={rows.length === 0}
            onClick={() =>
              downloadCsv(
                `katha-audit-${new Date().toISOString().slice(0, 10)}`,
                [
                  { key: "created_at", label: "When" },
                  { key: "admin_email", label: "Admin" },
                  { key: "action", label: "Action" },
                  { key: "target_type", label: "Target type" },
                  { key: "target_id", label: "Target" },
                  { key: "note", label: "Note" },
                  { key: "change", label: "Change" },
                ],
                rows.map((r) => ({ ...r, change: summarise(r.before, r.after) })),
              )
            }
          >
            Export CSV
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <SearchInput value={query} onChange={setQuery} placeholder="Admin, target or note" />
          <Select
            aria-label="Action filter"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setOffset(0);
            }}
            className="w-56"
          >
            <option value="">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
          {loading && data && <span className="text-xs text-muted">Refreshing…</span>}
        </div>

        {error && data && <InlineError message={error} onRetry={refetch} />}
        {error && !data ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : !data ? (
          <LoadingState />
        ) : (
          <>
            {rows.length === 0 ? (
              <EmptyState
                title={q ? "No matches on this page" : offset > 0 ? "Nothing on this page" : "Nothing recorded yet"}
                description={
                  q
                    ? "Search applies to the rows loaded on this page."
                    : "Bans, coin grants, flag changes and settings saves appear here as they happen."
                }
              />
            ) : (
              <Table minWidth={900} maxHeight="70vh">
                <thead>
                  <tr>
                    <Th sticky>When</Th>
                    <Th sticky>Admin</Th>
                    <Th sticky>Action</Th>
                    <Th sticky>Target</Th>
                    <Th sticky>Change</Th>
                    <Th sticky>Note</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-surface-2/50">
                      <Td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(r.created_at)}</Td>
                      <Td className="text-xs">{r.admin_email ?? "—"}</Td>
                      <Td className="font-medium">{ACTIONS.find((a) => a.value === r.action)?.label ?? r.action}</Td>
                      <Td className="font-mono text-xs text-muted" title={r.target_id ?? undefined}>
                        {r.target_type ? `${r.target_type}:${(r.target_id ?? "").slice(0, 8)}` : "—"}
                      </Td>
                      <Td className="max-w-xs truncate text-xs" title={summarise(r.before, r.after)}>
                        {summarise(r.before, r.after)}
                      </Td>
                      <Td className="max-w-xs truncate text-xs text-muted" title={r.note ?? undefined}>
                        {r.note ?? "—"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {(data.items.length > 0 || offset > 0) && (
              <Pagination
                offset={offset}
                limit={limit}
                count={data.items.length}
                hasNext={data.hasNext}
                onChange={setOffset}
                onLimitChange={(n) => {
                  setLimit(n);
                  setOffset(0);
                }}
              />
            )}
          </>
        )}
      </Card>
    </>
  );
}
