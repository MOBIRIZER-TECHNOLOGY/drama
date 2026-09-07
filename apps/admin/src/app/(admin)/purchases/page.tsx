"use client";

import { useState } from "react";
import { api, call } from "@/lib/api";
import { fmtDateTime, fmtMoney, shortId } from "@/lib/format";
import { useQuery } from "@/lib/use-query";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  InlineError,
  LoadingState,
  PageHeader,
  Pagination,
  Select,
  Table,
  Td,
  Th,
  statusTone,
} from "@/components/ui";

const LIMIT = 50;

export default function PurchasesPage() {
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);

  const { data, loading, error, refetch } = useQuery(`purchases:${status}:${offset}`, async () => {
    const rows = await call(api.GET("/v1/admin/purchases", { params: { query: { status: status || undefined, limit: LIMIT + 1, offset } } }));
    return { items: rows.slice(0, LIMIT), hasNext: rows.length > LIMIT };
  });

  return (
    <>
      <PageHeader title="Purchases" description="Coin pack and VIP orders across Stripe and Razorpay." />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <Select
            aria-label="Status filter"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
            className="w-40"
          >
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="failed">Failed</option>
            <option value="refunded">Refunded</option>
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
            {data.items.length === 0 ? (
              <EmptyState
                title={offset > 0 ? "Nothing on this page" : "No purchases"}
                description={offset > 0 ? "Go back a page." : status ? "None with this status." : "Orders appear here once checkout starts."}
              />
            ) : (
              <Table minWidth={860}>
                <thead>
                  <tr>
                    <Th>Order</Th>
                    <Th>User</Th>
                    <Th>Pack</Th>
                    <Th>Gateway</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Amount</Th>
                    <Th className="text-right">Coins</Th>
                    <Th>Created</Th>
                    <Th>Paid</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((p) => (
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
              <Pagination offset={offset} limit={LIMIT} count={data.items.length} hasNext={data.hasNext} onChange={setOffset} />
            )}
          </>
        )}
      </Card>
    </>
  );
}
