"use client";

import { useMemo, useState } from "react";
import { api, call } from "@/lib/api";
import { downloadCsv } from "@/lib/editing";
import { fmtDateTime, fmtMoney, shortId } from "@/lib/format";
import { useQuery } from "@/lib/use-query";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  InlineError,
  Input,
  LoadingState,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Table,
  Td,
  Th,
  statusTone,
} from "@/components/ui";

export default function PurchasesPage() {
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(50);

  const reset = () => setOffset(0);

  const { data, loading, error, refetch } = useQuery(`purchases:${status}:${offset}:${limit}`, async () => {
    const rows = await call(
      api.GET("/v1/admin/purchases", { params: { query: { status: status || undefined, limit: limit + 1, offset } } }),
    );
    return { items: rows.slice(0, limit), hasNext: rows.length > limit };
  });

  /**
   * Order id, user and date filtering happen here rather than server-side.
   *
   * A Stripe dispute arrives with an order id or an email and neither could be looked up at all, which made the
   * screen useless for the job it exists for. Filtering the loaded page is a real improvement over nothing;
   * server-side search is logged in docs/frontend-gaps.md as the proper fix, and this narrows scope to one page
   * rather than pretending to search the whole table.
   */
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const after = from ? new Date(from).getTime() : null;
    const before = to ? new Date(to).getTime() + 86_400_000 : null;
    return (data?.items ?? []).filter((p) => {
      if (q && !`${p.id} ${p.user_public_id ?? ""} ${p.user_id} ${p.pack_name}`.toLowerCase().includes(q)) return false;
      const created = new Date(p.created_at).getTime();
      if (after != null && created < after) return false;
      if (before != null && created >= before) return false;
      return true;
    });
  }, [data, query, from, to]);

  /** Per-currency subtotals of what was actually collected — finance's first question, previously unanswerable. */
  const totals = useMemo(() => {
    const acc = new Map<string, { amount: number; coins: number; count: number }>();
    for (const p of rows) {
      if (p.status !== "paid") continue;
      const cur = acc.get(p.currency) ?? { amount: 0, coins: 0, count: 0 };
      cur.amount += p.amount;
      cur.coins += p.coins_granted;
      cur.count += 1;
      acc.set(p.currency, cur);
    }
    return [...acc.entries()];
  }, [rows]);

  const exportCsv = () =>
    downloadCsv(
      `katha-purchases-${new Date().toISOString().slice(0, 10)}`,
      [
        { key: "id", label: "Order" },
        { key: "user", label: "User" },
        { key: "pack_name", label: "Pack" },
        { key: "gateway", label: "Gateway" },
        { key: "status", label: "Status" },
        { key: "currency", label: "Currency" },
        { key: "amount", label: "Amount" },
        { key: "coins_granted", label: "Coins" },
        { key: "created_at", label: "Created" },
        { key: "paid_at", label: "Paid" },
      ],
      rows.map((p) => ({ ...p, user: p.user_public_id ?? p.user_id })),
    );

  return (
    <>
      <PageHeader
        title="Purchases"
        description="Coin pack and VIP orders across Stripe, Razorpay and Google Play."
        actions={
          <Button size="sm" onClick={exportCsv} disabled={rows.length === 0}>
            Export CSV
          </Button>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <SearchInput
            value={query}
            onChange={(v) => {
              setQuery(v);
              reset();
            }}
            placeholder="Order id, user or pack"
          />
          <Select
            aria-label="Status filter"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              reset();
            }}
            className="w-40"
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="failed">Failed</option>
            <option value="refunded">Refunded</option>
          </Select>
          <label className="flex items-center gap-2 text-xs text-muted">
            From
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-36" />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted">
            To
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-36" />
          </label>
          {loading && data && <span className="text-xs text-muted">Refreshing…</span>}
        </div>

        {totals.length > 0 && (
          <div className="flex flex-wrap gap-4 border-b border-line bg-surface-2/40 px-4 py-2.5 text-sm">
            {totals.map(([currency, t]) => (
              <span key={currency} className="text-ink">
                <span className="text-muted">Collected ({currency}):</span>{" "}
                <strong className="tabular-nums">{fmtMoney(t.amount, currency)}</strong>{" "}
                <span className="text-muted">
                  · {t.count} order{t.count === 1 ? "" : "s"} · {t.coins.toLocaleString()} coins
                </span>
              </span>
            ))}
          </div>
        )}

        {error && data && <InlineError message={error} onRetry={refetch} />}
        {error && !data ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : !data ? (
          <LoadingState />
        ) : (
          <>
            {rows.length === 0 ? (
              <EmptyState
                title={query || from || to ? "No matches on this page" : offset > 0 ? "Nothing on this page" : "No purchases"}
                description={
                  query || from || to
                    ? "Filters apply to the rows loaded on this page. Try another page, or widen the range."
                    : offset > 0
                      ? "Go back a page."
                      : status
                        ? "None with this status."
                        : "Orders appear here once checkout starts."
                }
              />
            ) : (
              <Table minWidth={860} maxHeight="70vh">
                <thead>
                  <tr>
                    <Th sticky>Order</Th>
                    <Th sticky>User</Th>
                    <Th sticky>Pack</Th>
                    <Th sticky>Gateway</Th>
                    <Th sticky>Status</Th>
                    <Th sticky className="text-right">
                      Amount
                    </Th>
                    <Th sticky className="text-right">
                      Coins
                    </Th>
                    <Th sticky>Created</Th>
                    <Th sticky>Paid</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className="hover:bg-surface-2/50">
                      <Td className="font-mono text-xs text-muted" title={p.id}>
                        {shortId(p.id)}
                      </Td>
                      <Td className="font-mono text-xs">{p.user_public_id ?? shortId(p.user_id)}</Td>
                      <Td className="font-medium">{p.pack_name}</Td>
                      <Td className="capitalize">{p.gateway}</Td>
                      <Td>
                        <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                      </Td>
                      <Td className="text-right tabular-nums">{fmtMoney(p.amount, p.currency)}</Td>
                      <Td className="text-right tabular-nums">{p.coins_granted}</Td>
                      <Td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(p.created_at)}</Td>
                      <Td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(p.paid_at)}</Td>
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
