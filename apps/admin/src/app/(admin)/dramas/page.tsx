"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { aiErrorMessage, jobQueuedText, reembedAll } from "@/lib/ai";
import { api, call, type Schemas } from "@/lib/api";
import { fmtCompact, fmtDate } from "@/lib/format";
import { seriesTitle } from "@/lib/series";
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
  InlineError,
  LinkButton,
  LoadingState,
  Pagination,
  PageHeader,
  SearchInput,
  Select,
  Table,
  Td,
  Th,
  statusTone,
} from "@/components/ui";

type Series = Schemas["AdminSeriesOut"];
const LIMIT = 20;

export default function DramasPage() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [deleting, setDeleting] = useState<Series | null>(null);
  const [busy, setBusy] = useState(false);
  const [reembedOpen, setReembedOpen] = useState(false);
  const [reembedding, setReembedding] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const key = `series:${debounced}:${status}:${offset}`;
  const { data, loading, error, refetch } = useQuery(key, async () => {
    // One extra row tells us whether a next page exists.
    const page = await call(
      api.GET("/v1/admin/series", {
        params: {
          query: {
            q: debounced || undefined,
            status: (status || undefined) as Schemas["PublishStatus"] | undefined,
            limit: LIMIT,
            offset,
          },
        },
      }),
    );
    // The endpoint returns a real total now, so hasNext is derived from it rather than from over-fetching by
    // one row — and the pager can offer page numbers instead of only Next.
    return { items: page.items, total: page.total, hasNext: offset + page.items.length < page.total };
  });

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    const victim = deleting;
    try {
      await call(api.DELETE("/v1/admin/series/{series_id}", { params: { path: { series_id: victim.id } } }));
      toast.success(`Deleted “${seriesTitle(victim)}”`);
      setDeleting(null);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  async function runReembedAll() {
    setReembedding(true);
    try {
      const job = await reembedAll();
      toast.info(jobQueuedText("Catalogue embedding refresh", job));
      setReembedOpen(false);
    } catch (e) {
      toast.error(aiErrorMessage(e));
    } finally {
      setReembedding(false);
    }
  }

  const filtered = Boolean(debounced || status);

  return (
    <>
      <PageHeader
        title="Dramas"
        description="Series, episodes and their availability."
        actions={
          <>
            <Button onClick={() => setReembedOpen(true)}>
              <Icon name="refresh" size={15} /> Re-embed all
            </Button>
            <LinkButton href="/dramas/assets">
              <Icon name="film" size={15} /> Video assets
            </LinkButton>
            <LinkButton href="/dramas/new" variant="primary">
              <Icon name="plus" size={15} /> New series
            </LinkButton>
          </>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v);
              setOffset(0);
            }}
            placeholder="Search title or slug…"
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
            <option value="draft">Draft</option>
            <option value="review">In review</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </Select>
          {data && <span className="text-xs text-muted">{data.total} series</span>}
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
                title={filtered ? "No series match" : offset > 0 ? "Nothing on this page" : "No series yet"}
                description={filtered ? "Try a different search or filter." : offset > 0 ? "Go back a page." : "Create your first series to start publishing."}
                action={!filtered && offset === 0 ? <LinkButton href="/dramas/new" variant="primary">New series</LinkButton> : undefined}
              />
            ) : (
              <Table minWidth={820}>
                <thead>
                  <tr>
                    <Th>Series</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Episodes</Th>
                    <Th className="text-right">Views</Th>
                    <Th className="text-right">Likes</Th>
                    <Th>Updated</Th>
                    <Th className="text-right">Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((s) => (
                    <tr key={s.id} className="hover:bg-surface-2/50">
                      <Td>
                        <Link href={`/dramas/${s.id}`} className="flex items-center gap-3">
                          <span className="h-14 w-8 shrink-0 overflow-hidden rounded bg-surface-2">
                            {s.cover_url && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={s.cover_url} alt="" className="h-full w-full object-cover" />
                            )}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-ink">{seriesTitle(s)}</span>
                            <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                              {s.slug}
                              {s.is_featured && <Badge tone="accent">featured</Badge>}
                              {s.is_premium && <Badge tone="gold">premium</Badge>}
                            </span>
                          </span>
                        </Link>
                      </Td>
                      <Td>
                        <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                      </Td>
                      <Td className="text-right tabular-nums">{s.episode_count}</Td>
                      <Td className="text-right tabular-nums">{fmtCompact(s.view_count)}</Td>
                      <Td className="text-right tabular-nums">{fmtCompact(s.like_count)}</Td>
                      <Td className="whitespace-nowrap text-muted">{fmtDate(s.updated_at)}</Td>
                      <Td className="text-right">
                        <div className="flex justify-end gap-1">
                          <LinkButton href={`/dramas/${s.id}`} size="sm" variant="ghost">
                            Edit
                          </LinkButton>
                          <Button size="sm" variant="ghost" aria-label={`Delete ${seriesTitle(s)}`} onClick={() => setDeleting(s)}>
                            <Icon name="trash" size={14} className="text-danger" />
                          </Button>
                        </div>
                      </Td>
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

      <ConfirmDialog
        open={reembedOpen}
        title="Refresh all embeddings"
        message="Queue a pgvector refresh for every series? This runs in the background and can take a while on a large catalogue. Search and “similar series” improve as it completes."
        confirmLabel="Queue refresh"
        destructive={false}
        loading={reembedding}
        onConfirm={runReembedAll}
        onCancel={() => setReembedOpen(false)}
      />

      <ConfirmDialog
        open={deleting != null}
        title="Delete series"
        message={`Delete “${deleting ? seriesTitle(deleting) : ""}” and all of its episodes? This cannot be undone.`}
        loading={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
