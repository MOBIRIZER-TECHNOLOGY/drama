"use client";

import Link from "next/link";
import { useState } from "react";
import { api, call, type Schemas } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useQuery } from "@/lib/use-query";
import { useToast } from "@/components/toast";
import {
  Badge,
  Button,
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

type Report = Schemas["AdminReportOut"];
type Status = "open" | "resolved" | "dismissed";

export default function ReportsPage() {
  const toast = useToast();
  const [status, setStatus] = useState<string>("open");
  const [busy, setBusy] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(50);
  // Newest-first is the wrong order for an SLA: the report waiting longest is the one that matters.
  const [oldestFirst, setOldestFirst] = useState(false);

  const { data, loading, error, refetch, setData } = useQuery(
    `reports:${status}:${offset}:${limit}:${oldestFirst}`,
    () =>
      call(
        api.GET("/v1/admin/reports", {
          params: {
            query: {
              status: (status || undefined) as Status | undefined,
              limit,
              offset,
              oldest_first: oldestFirst,
            },
          },
        }),
      ),
  );
  const rows = data?.items ?? [];

  async function update(r: Report, next: Status) {
    setBusy(r.id);
    // Optimistic: flip the badge in place; the list is refetched afterwards so a filtered view settles.
    setData((prev) => (prev ? { ...prev, items: prev.items.map((x) => (x.id === r.id ? { ...x, status: next } : x)) } : { items: [], total: 0 }));
    try {
      await call(api.PUT("/v1/admin/reports/{report_id}", { params: { path: { report_id: r.id } }, body: { status: next } }));
      toast.success(`Report ${next}`);
      refetch();
    } catch (e) {
      // Roll back only this row, from whatever the list looks like now.
      setData((prev) => (prev ? { ...prev, items: prev.items.map((x) => (x.id === r.id ? { ...x, status: r.status } : x)) } : { items: [], total: 0 }));
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title="Reports" description="Content flagged by viewers." />
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
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
            <option value="">All</option>
          </Select>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={oldestFirst}
              onChange={(e) => {
                setOldestFirst(e.target.checked);
                setOffset(0);
              }}
              className="h-4 w-4 accent-accent"
            />
            Oldest first
          </label>
          {data && <span className="text-xs text-muted">{data.total} total</span>}
          {loading && data && <span className="text-xs text-muted">Refreshing…</span>}
        </div>
        {error && data && <InlineError message={error} onRetry={refetch} />}
        {error && !data ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : !data ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <EmptyState
            title={offset > 0 ? "Nothing on this page" : status === "open" ? "Inbox zero" : "No reports"}
            description={offset > 0 ? "Go back a page." : status === "open" ? "No open reports right now." : undefined}
          />
        ) : (
          <Table minWidth={820}>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Reporter</Th>
                <Th>Content</Th>
                <Th>Reason</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="align-top hover:bg-surface-2/50">
                  <Td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(r.created_at)}</Td>
                  <Td className="font-mono text-xs">{r.reporter_public_id ?? "anonymous"}</Td>
                  <Td>
                    {r.series_id ? (
                      <Link href={`/dramas/${r.series_id}`} className="font-medium text-accent hover:underline">
                        {r.series_title ?? "Series"}
                      </Link>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                    {r.episode_id && <span className="block font-mono text-[11px] text-muted">episode {r.episode_id.slice(0, 8)}…</span>}
                  </Td>
                  <Td>
                    <span className="block font-medium capitalize">{r.reason.replace(/_/g, " ")}</span>
                    {r.details && <span className="block max-w-md whitespace-pre-wrap text-xs text-ink-2">{r.details}</span>}
                  </Td>
                  <Td>
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  </Td>
                  <Td className="text-right">
                    {r.status === "open" ? (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="primary" loading={busy === r.id} onClick={() => update(r, "resolved")}>
                          Resolve
                        </Button>
                        <Button size="sm" loading={busy === r.id} onClick={() => update(r, "dismissed")}>
                          Dismiss
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="ghost" loading={busy === r.id} onClick={() => update(r, "open")}>
                        Reopen
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {data && (rows.length > 0 || offset > 0) && (
          <Pagination
            offset={offset}
            limit={limit}
            count={rows.length}
            hasNext={offset + rows.length < data.total}
            total={data.total}
            onChange={setOffset}
            onLimitChange={(n) => {
              setLimit(n);
              setOffset(0);
            }}
          />
        )}
      </Card>
    </>
  );
}
