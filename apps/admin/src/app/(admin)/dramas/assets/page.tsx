"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ApiError, call, type Schemas } from "@/lib/api";
import { startPolling } from "@/lib/polling";
import { retryVideo, type VideoAsset } from "@/lib/uploads";
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

const STATUSES: Schemas["AssetStatus"][] = ["uploaded", "queued", "transcoding", "ready", "failed"];
const PENDING = new Set<Schemas["AssetStatus"]>(["uploaded", "queued", "transcoding"]);

export default function VideoAssetsPage() {
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [deleting, setDeleting] = useState<VideoAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(50);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data, loading, error, refetch, setData } = useQuery(`video-assets:${status}:${debounced}:${offset}:${limit}`, () =>
    call(
      api.GET("/v1/admin/uploads/videos", {
        params: {
          query: {
            status: (status || undefined) as Schemas["AssetStatus"] | undefined,
            q: debounced || undefined,
            limit,
            offset,
          },
        },
      }),
    ),
  );
  const rows = data?.items ?? [];
  const counts = data?.counts ?? {};
  const failed = counts.failed ?? 0;

  // Keep transcoding rows fresh without the admin having to reload (paused while the tab is hidden).
  // Driven by the tally rather than the page: a transcode running on page 3 still deserves a live view.
  const pending = STATUSES.some((s) => PENDING.has(s) && (counts[s] ?? 0) > 0);
  useEffect(() => {
    if (!pending) return;
    return startPolling({
      tick: async () => {
        refetch();
        return false;
      },
      intervalMs: 5000,
    });
  }, [pending, refetch]);

  async function retry(a: VideoAsset) {
    setRetrying(a.id);
    try {
      const updated = await retryVideo(a.id);
      setData((prev) => (prev ? { ...prev, items: prev.items.map((x) => (x.id === a.id ? updated : x)) } : prev!));
      toast.info("Transcode re-queued");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setRetrying(null);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    setDeleteError(null);
    const victim = deleting;
    try {
      await call(api.DELETE("/v1/admin/uploads/videos/{asset_id}", { params: { path: { asset_id: victim.id } } }));
      toast.success("Asset deleted");
      setDeleting(null);
      refetch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Delete failed";
      if (e instanceof ApiError && e.code === "asset_in_use") {
        setDeleteError(msg);
      } else {
        toast.error(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Video assets"
        description="Every uploaded source video and its transcode state. Delete orphans; assets attached to an episode are protected."
        actions={
          <div className="flex items-center gap-3">
            {/* A failure that only shows up once you think to filter for it is a failure nobody sees. */}
            {failed > 0 && status !== "failed" && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setStatus("failed");
                  setOffset(0);
                }}
              >
                <Badge tone="danger">{failed} failed</Badge>
              </Button>
            )}
            <Link href="/dramas" className="text-sm text-muted hover:text-ink">
              ← Back to dramas
            </Link>
          </div>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <Select
            aria-label="Status filter"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
            className="w-48"
          >
            <option value="">All statuses{data ? ` (${sum(counts)})` : ""}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
                {data ? ` (${counts[s] ?? 0})` : ""}
              </option>
            ))}
          </Select>
          <SearchInput
            value={q}
            onChange={(v) => {
              setQ(v);
              setOffset(0);
            }}
            placeholder="Search source key…"
          />
          <Button size="sm" variant="ghost" onClick={refetch} loading={loading && Boolean(data)}>
            <Icon name="refresh" size={13} /> Refresh
          </Button>
          {pending && <span className="text-xs text-muted">Auto-refreshing while transcodes run</span>}
        </div>
        {error && data && <InlineError message={error} onRetry={refetch} />}
        {error && !data ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : !data ? (
          <LoadingState />
        ) : rows.length === 0 ? (
          <EmptyState
            title={debounced ? "No matches" : status ? `No ${status} assets` : "No video assets"}
            description={
              debounced
                ? `No source key contains “${debounced}”.`
                : "Assets appear here after an episode video is uploaded."
            }
          />
        ) : (
          <Table minWidth={820}>
            <thead>
              <tr>
                <Th>Status</Th>
                <Th>Source key</Th>
                <Th>Duration</Th>
                <Th>HLS</Th>
                <Th>Error</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="align-top hover:bg-surface-2/50">
                  <Td>
                    <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                  </Td>
                  <Td className="max-w-xs break-all font-mono text-xs" title={a.id}>
                    {a.source_key}
                    <span className="block text-[11px] text-muted">{a.id}</span>
                  </Td>
                  <Td className="tabular-nums text-ink-2">{a.duration_sec != null ? formatDuration(a.duration_sec) : "—"}</Td>
                  <Td className="max-w-[12rem] truncate font-mono text-xs text-muted" title={a.hls_master_key ?? undefined}>
                    {a.hls_master_key ?? "—"}
                  </Td>
                  <Td className="max-w-xs text-xs text-danger">{a.error ?? <span className="text-muted">—</span>}</Td>
                  <Td className="text-right">
                    <div className="flex justify-end gap-1">
                      {a.status === "failed" && (
                        <Button size="sm" variant="ghost" loading={retrying === a.id} onClick={() => retry(a)}>
                          <Icon name="refresh" size={13} /> Retry
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Delete asset ${a.source_key}`}
                        onClick={() => {
                          setDeleteError(null);
                          setDeleting(a);
                        }}
                      >
                        <Icon name="trash" size={14} className="text-danger" />
                      </Button>
                    </div>
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

      <ConfirmDialog
        open={deleting != null}
        title="Delete video asset"
        message={
          deleteError
            ? `${deleteError} Detach it from the episode first, then delete.`
            : `Delete ${deleting?.source_key ?? "this asset"} and its transcoded output? Assets referenced by an episode are refused by the API.`
        }
        loading={busy}
        onConfirm={remove}
        onCancel={() => {
          setDeleting(null);
          setDeleteError(null);
        }}
      />
    </>
  );
}

function sum(counts: Record<string, number>) {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
