"use client";

import { useEffect, useState } from "react";
import { api, call, type Schemas } from "@/lib/api";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { useQuery } from "@/lib/use-query";
import { UserDrawer } from "@/components/users/user-drawer";
import {
  Badge,
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
  statusTone,
} from "@/components/ui";

type User = Schemas["AdminUserOut"];
const LIMIT = 25;

export default function UsersPage() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<User | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data, loading, error, refetch, setData } = useQuery(`users:${debounced}:${status}:${offset}`, async () => {
    const page = await call(
      api.GET("/v1/admin/users", {
        params: {
          query: {
            q: debounced || undefined,
            status: (status || undefined) as Schemas["UserStatus"] | undefined,
            limit: LIMIT + 1,
            offset,
          },
        },
      }),
    );
    return { items: page.items.slice(0, LIMIT), total: page.total, hasNext: page.items.length > LIMIT };
  });

  function applyUpdate(u: User) {
    setData((prev) => (prev ? { ...prev, items: prev.items.map((x) => (x.id === u.id ? u : x)) } : prev!));
    setSelected(u);
  }

  return (
    <>
      <PageHeader title="Users" description="Search viewers, adjust wallets and moderate accounts." />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v);
              setOffset(0);
            }}
            placeholder="Search name, email, phone or ID…"
          />
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
            <option value="active">Active</option>
            <option value="banned">Banned</option>
            <option value="deleted">Deleted</option>
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
              <EmptyState title={offset > 0 ? "Nothing on this page" : "No users found"} description={offset > 0 ? "Go back a page." : "Try a different search or status."} />
            ) : (
              <Table minWidth={820}>
                <thead>
                  <tr>
                    <Th>User</Th>
                    <Th>Contact</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Coins</Th>
                    <Th>Locale</Th>
                    <Th>Joined</Th>
                    <Th>Last seen</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((u) => (
                    // The row is a convenience click target; the accessible control is the name button.
                    <tr key={u.id} onClick={() => setSelected(u)} className="cursor-pointer hover:bg-surface-2/50">
                      <Td>
                        <div className="flex items-center gap-3">
                          <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-surface-2 text-xs font-semibold text-ink-2">
                            {u.avatar_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={u.avatar_url} alt="" className="h-full w-full object-cover" />
                            ) : (
                              (u.display_name ?? u.public_id).slice(0, 1).toUpperCase()
                            )}
                          </span>
                          <span className="min-w-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelected(u);
                              }}
                              className="block max-w-full truncate text-left font-medium text-ink hover:text-accent hover:underline"
                            >
                              {u.display_name ?? <span className="text-muted">No name</span>}
                            </button>
                            <span className="block font-mono text-xs text-muted">{u.public_id}</span>
                          </span>
                        </div>
                      </Td>
                      <Td className="text-xs text-ink-2">
                        {u.email && <span className="block">{u.email}</span>}
                        {u.phone && <span className="block">{u.phone}</span>}
                        {!u.email && !u.phone && <span className="text-muted">—</span>}
                      </Td>
                      <Td>
                        <Badge tone={statusTone(u.status)}>{u.status}</Badge>
                      </Td>
                      <Td className="text-right tabular-nums">{fmtNumber(u.coin_balance)}</Td>
                      <Td className="text-xs text-muted">
                        {u.locale}
                        {u.country ? ` · ${u.country}` : ""}
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(u.created_at)}</Td>
                      <Td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(u.last_seen_at)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {(data.items.length > 0 || offset > 0) && (
              <Pagination offset={offset} limit={LIMIT} count={data.items.length} hasNext={data.hasNext} total={data.total} onChange={setOffset} />
            )}
          </>
        )}
      </Card>

      {selected && (
        <UserDrawer
          user={selected}
          onClose={() => setSelected(null)}
          onUpdated={applyUpdate}
          onDeleted={() => {
            setSelected(null);
            refetch();
          }}
        />
      )}
    </>
  );
}
