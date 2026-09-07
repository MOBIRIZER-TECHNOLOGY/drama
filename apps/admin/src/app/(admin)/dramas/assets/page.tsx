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
  Select,
  Table,
  Td,
  Th,
  statusTone,
} from "@/components/ui";

const STATUSES: Schemas["AssetStatus"][] = ["uploaded", "queued", "transcoding", "ready", "failed"];
const PENDING = new Set<Schemas["AssetStatus"]>(["uploaded", "queued", "transcoding"]);
const LIMIT = 200;

export default function VideoAssetsPage() {
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [deleting, setDeleting] = useState<VideoAsset | null>(null);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data, loading, error, refetch, setData } = useQuery(`video-assets:${status}`, () =>
    call(
      api.GET("/v1/admin/uploads/videos", {
        params: { query: { status: (status || undefined) as Schemas["AssetStatus"] | undefined, limit: LIMIT } },
      }),
    ),
  );

  // Keep transcoding rows fresh without the admin having to reload (paused while the tab is hidden).
  const pending = (data ?? []).some((a) => PENDING.has(a.status));
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
      setData((prev) => (prev ?? []).map((x) => (x.id === a.id ? updated : x)));
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
          <Link href="/dramas" className="text-sm text-muted hover:text-ink">
            ← Back to dramas
          </Link>
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <Select aria-label="Status filter" value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
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
        ) : data.length === 0 ? (
          <EmptyState
            title={status ? `No ${status} assets` : "No video assets"}
            description="Assets appear here after an episode video is uploaded."
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
              {data.map((a) => (
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

function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
