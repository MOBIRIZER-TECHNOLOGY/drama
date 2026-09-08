"use client";

import { useEffect, useMemo, useState } from "react";
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
  const [debounced, setDebounced] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(50);

  const reset = () => setOffset(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  /**
   * Everything filters server-side now.
   *
   * The search box and the date range used to run over the rows already loaded, so a dispute quoting an order
   * id could only be found if that order happened to be on the current page — and the "collected" figure
   * beside it was a subtotal of whatever had loaded rather than of what was asked for.
   */
  const { data, loading, error, refetch } = useQuery(
    `purchases:${status}:${debounced}:${from}:${to}:${offset}:${limit}`,
    async () => {
      const page = await call(
        api.GET("/v1/admin/purchases", {
          params: {
            query: {
              status: status || undefined,
              q: debounced || undefined,
              date_from: from || undefined,
              date_to: to || undefined,
              limit,
              offset,
            },
          },
        }),
      );
      return {
        items: page.items,
        total: page.total,
        totalsByCurrency: page.totals_by_currency,
        hasNext: offset + page.items.length < page.total,
      };
    },
  );

  // Memoised because the CSV export and the per-page subtotals both depend on it.
  const rows = useMemo(() => data?.items ?? [], [data]);

  /** Per-currency subtotals for the rows on screen, shown beside the server's whole-set figure. */
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
          <Button size="sm" onClick={exportCsv} disabled={rows.length === 0} title="Exports the rows currently on screen">
            Export page ({rows.length})
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
            placeholder="Order id, payment id, user or email"
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
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                reset();
              }}
              className="h-8 w-36"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted">
            To
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-36" />
          </label>
          {loading && data && <span className="text-xs text-muted">Refreshing…</span>}
        </div>

        {(totals.length > 0 || data) && (
          <div className="flex flex-col gap-1.5 border-b border-line bg-surface-2/40 px-4 py-2.5 text-sm">
            {totals.length > 0 && (
              <div className="flex flex-wrap gap-4">
                {totals.map(([currency, t]) => (
                  <span key={currency} className="text-ink">
                    <span className="text-muted">On this page ({currency}):</span>{" "}
                    <strong className="tabular-nums">{fmtMoney(t.amount, currency)}</strong>{" "}
                    <span className="text-muted">
                      · {t.count} order{t.count === 1 ? "" : "s"} · {t.coins.toLocaleString()} coins
                    </span>
                  </span>
                ))}
              </div>
            )}
            {data && Object.keys(data.totalsByCurrency).length > 0 && (
              <div className="flex flex-wrap gap-4 text-xs">
                <span className="text-muted">
                  All {data.total} {status ? `${status} ` : ""}order{data.total === 1 ? "" : "s"}:
                </span>
                {Object.entries(data.totalsByCurrency).map(([currency, amount]) => (
                  <span key={currency} className="tabular-nums text-ink-2">
                    {fmtMoney(amount, currency)}
                  </span>
                ))}
              </div>
            )}
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
                title={debounced || from || to ? "No matches" : offset > 0 ? "Nothing on this page" : "No purchases"}
                description={
                  debounced || from || to
                    ? "Nothing in the whole table matches these filters. Try a different id, email or date range."
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
                        {p.gateway_payment_id && (
                          <span className="block text-[11px] text-muted" title={p.gateway_payment_id}>
                            {p.gateway_payment_id}
                          </span>
                        )}
                      </Td>
                      <Td className="font-mono text-xs">
                        {p.user_public_id ?? shortId(p.user_id)}
                        {p.user_email && <span className="block font-sans text-[11px] text-muted">{p.user_email}</span>}
                      </Td>
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
