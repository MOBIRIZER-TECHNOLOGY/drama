"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { api, call, type Schemas } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { CONTENT_RATINGS } from "@/lib/ratings";
import { useQuery } from "@/lib/use-query";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import {
  Badge,
  BulkBar,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  InlineError,
  LoadingState,
  Modal,
  PageHeader,
  Pagination,
  SelectCell,
  Select,
  TabPanel,
  Tabs,
  Table,
  Td,
  Textarea,
  Th,
  statusTone,
  useSelection,
} from "@/components/ui";

type Item = Schemas["ModerationItem"];
type Filter = "all" | "report" | "flagged_series";
type BulkAction = "resolved" | "dismissed" | "clear_flags";

export default function ModerationPage() {
  const toast = useToast();
  const tabsId = useId();
  const [filter, setFilter] = useState<Filter>("all");
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(50);
  const { data, loading, error, refetch, setData } = useQuery(`moderation:${filter}:${offset}:${limit}`, () =>
    call(
      api.GET("/v1/admin/moderation", {
        params: {
          query: {
            // "All" sends no kind; the server still returns both counts, so the badges stay honest.
            kind: filter === "all" ? undefined : filter,
            limit,
            offset,
          },
        },
      }),
    ),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ item: Item; action: "unpublish" | "clear_flags" } | null>(null);
  const [rating, setRating] = useState<Item | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState<BulkAction | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);

  // Server-ordered (oldest first) and server-filtered; the counts are over the whole table, not this page.
  const items = data?.items ?? [];
  const counts = { report: data?.reports ?? 0, flagged: data?.flagged ?? 0 };

  // Reports and series ids live in different tables, so the row key carries the kind to keep them apart.
  const rows = items.map((i) => ({ id: `${i.kind}:${i.id}`, item: i }));
  const sel = useSelection(rows);
  const chosen = rows.filter((r) => sel.has(r.id)).map((r) => r.item);
  const chosenReports = chosen.filter((i) => i.kind === "report");
  const chosenFlagged = chosen.filter((i) => i.kind === "flagged_series" && i.series_id);

  async function resolveReport(item: Item, status: "resolved" | "dismissed") {
    setBusy(item.id);
    setData((prev) =>
      prev ? { ...prev, items: prev.items.filter((x) => x.id !== item.id), total: Math.max(0, prev.total - 1) } : prev!,
    );
    try {
      await call(api.PUT("/v1/admin/reports/{report_id}", { params: { path: { report_id: item.id } }, body: { status } }));
      toast.success(`Report ${status}`);
    } catch (e) {
      setData((prev) => (prev ? { ...prev, items: [item, ...prev.items], total: prev.total + 1 } : prev!));
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  async function moderate(item: Item, body: Schemas["ModerateSeriesIn"], successText: string) {
    if (!item.series_id) return;
    setBusy(item.id);
    try {
      await call(api.POST("/v1/admin/moderation/series/{series_id}", { params: { path: { series_id: item.series_id } }, body }));
      toast.success(successText);
      if (body.action === "clear_flags")
        setData((prev) =>
          prev ? { ...prev, items: prev.items.filter((x) => x.id !== item.id), total: Math.max(0, prev.total - 1) } : prev!,
        );
      else refetch();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
      return false;
    } finally {
      setBusy(null);
    }
  }

  /**
   * Works the queue in bulk.
   *
   * A review-bomb or a bad ingest puts dozens of near-identical items in here at once, and clearing them one
   * at a time was the whole job. Each item is still its own API call — there is no batch endpoint and inventing
   * one would hide partial failure — so the run reports exactly how many landed and leaves the rest selected.
   */
  async function runBulk(action: BulkAction) {
    const targets = action === "clear_flags" ? chosenFlagged : chosenReports;
    if (targets.length === 0) return;
    setBulkRunning(true);
    const failed: Item[] = [];
    for (const item of targets) {
      try {
        if (action === "clear_flags") {
          await call(
            api.POST("/v1/admin/moderation/series/{series_id}", {
              params: { path: { series_id: item.series_id as string } },
              body: { action: "clear_flags" },
            }),
          );
        } else {
          await call(api.PUT("/v1/admin/reports/{report_id}", { params: { path: { report_id: item.id } }, body: { status: action } }));
        }
      } catch {
        failed.push(item);
      }
    }
    const done = targets.length - failed.length;
    if (done > 0) toast.success(`${done} ${done === 1 ? "item" : "items"} ${action === "clear_flags" ? "cleared" : action}`);
    if (failed.length > 0) toast.error(`${failed.length} could not be updated and stay selected.`);
    // Keep only what failed selected, so a retry acts on exactly the remainder.
    sel.clear();
    for (const item of failed) sel.toggle(`${item.kind}:${item.id}`, true);
    setBulkRunning(false);
    setBulkConfirm(null);
    refetch();
  }

  async function runConfirm() {
    if (!confirm) return;
    const { item, action } = confirm;
    const ok = await moderate(
      item,
      { action },
      action === "unpublish" ? `“${item.series_title ?? "Series"}” moved to review` : `Flags cleared on “${item.series_title ?? "Series"}”`,
    );
    if (ok) setConfirm(null);
  }

  return (
    <>
      <PageHeader
        title="Moderation"
        description="Open viewer reports and series the metadata AI flagged, in one queue."
        actions={
          <Button size="sm" onClick={refetch} loading={loading && Boolean(data)}>
            <Icon name="refresh" size={14} /> Refresh
          </Button>
        }
      />
      <Card>
        <div className="px-4 pt-2">
          <Tabs
            id={tabsId}
            label="Queue filter"
            value={filter}
            onChange={(v) => {
              setFilter(v);
              setOffset(0);
              sel.clear();
            }}
            tabs={[
              { value: "all", label: "All", badge: data ? <Badge>{data.reports + data.flagged}</Badge> : undefined },
              { value: "report", label: "Reports", badge: data ? <Badge tone={counts.report ? "warning" : "neutral"}>{counts.report}</Badge> : undefined },
              { value: "flagged_series", label: "AI-flagged", badge: data ? <Badge tone={counts.flagged ? "danger" : "neutral"}>{counts.flagged}</Badge> : undefined },
            ]}
          />
        </div>
        {error && data && <InlineError message={error} onRetry={refetch} />}
        <TabPanel tabsId={tabsId} value={filter}>
          {error && !data ? (
            <ErrorState message={error} onRetry={refetch} />
          ) : !data ? (
            <LoadingState />
          ) : items.length === 0 ? (
            <EmptyState title="Queue is clear" description={filter === "all" ? "No open reports or flagged series." : "Nothing in this bucket."} />
          ) : (
            <Table minWidth={900}>
              <thead>
                <tr>
                  <SelectCell
                    header
                    label="Select all in this queue"
                    checked={sel.allSelected}
                    indeterminate={sel.someSelected}
                    onChange={sel.toggleAll}
                  />
                  <Th>When</Th>
                  <Th>Type</Th>
                  <Th>Series</Th>
                  <Th>Reason</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={`${i.kind}:${i.id}`} className="align-top hover:bg-surface-2/50">
                    <SelectCell
                      label={`Select ${i.series_title ?? i.reason}`}
                      checked={sel.has(`${i.kind}:${i.id}`)}
                      onChange={(next) => sel.toggle(`${i.kind}:${i.id}`, next)}
                    />
                    <Td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(i.created_at)}</Td>
                    <Td>
                      <Badge tone={i.kind === "report" ? "warning" : "danger"}>{i.kind === "report" ? "report" : "AI flag"}</Badge>
                    </Td>
                    <Td>
                      {i.series_id ? (
                        <Link href={`/dramas/${i.series_id}`} className="font-medium text-accent hover:underline">
                          {i.series_title ?? "Untitled series"}
                        </Link>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                      {i.series_status && (
                        <span className="ml-2">
                          <Badge tone={statusTone(i.series_status)}>{i.series_status}</Badge>
                        </span>
                      )}
                    </Td>
                    <Td>
                      {i.kind === "flagged_series" ? (
                        <span className="flex flex-wrap gap-1">
                          {i.reason
                            .split(",")
                            .map((f) => f.trim())
                            .filter(Boolean)
                            .map((f) => (
                              <Badge key={f} tone="danger">
                                {f}
                              </Badge>
                            ))}
                        </span>
                      ) : (
                        <span className="block font-medium capitalize">{i.reason.replace(/_/g, " ")}</span>
                      )}
                      {i.details && <span className="mt-1 block max-w-md whitespace-pre-wrap text-xs text-ink-2">{i.details}</span>}
                    </Td>
                    <Td className="text-right">
                      {i.kind === "report" ? (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="primary" loading={busy === i.id} onClick={() => resolveReport(i, "resolved")}>
                            Resolve
                          </Button>
                          <Button size="sm" loading={busy === i.id} onClick={() => resolveReport(i, "dismissed")}>
                            Dismiss
                          </Button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button size="sm" variant="primary" loading={busy === i.id} onClick={() => setConfirm({ item: i, action: "clear_flags" })}>
                            Clear flags
                          </Button>
                          <Button size="sm" loading={busy === i.id} onClick={() => setRating(i)}>
                            Set rating
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={busy === i.id}
                            disabled={i.series_status === "review" || i.series_status === "draft"}
                            title={i.series_status === "published" ? "Move back to review" : "Only published/archived series can be unpublished"}
                            onClick={() => setConfirm({ item: i, action: "unpublish" })}
                          >
                            Unpublish
                          </Button>
                          {i.series_id && (
                            <Link href={`/dramas/${i.series_id}`} className="inline-flex h-8 items-center gap-1 px-2 text-[13px] text-muted hover:text-ink">
                              <Icon name="external" size={13} /> Open
                            </Link>
                          )}
                        </div>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {data && (items.length > 0 || offset > 0) && (
            <Pagination
              offset={offset}
              limit={limit}
              count={items.length}
              hasNext={offset + items.length < data.total}
              total={data.total}
              onChange={(next) => {
                setOffset(next);
                sel.clear();
              }}
              onLimitChange={(n) => {
                setLimit(n);
                setOffset(0);
              }}
            />
          )}
          <BulkBar count={sel.count} onClear={sel.clear}>
            {chosenReports.length > 0 && (
              <>
                <Button size="sm" variant="primary" loading={bulkRunning} onClick={() => setBulkConfirm("resolved")}>
                  Resolve {chosenReports.length}
                </Button>
                <Button size="sm" loading={bulkRunning} onClick={() => setBulkConfirm("dismissed")}>
                  Dismiss {chosenReports.length}
                </Button>
              </>
            )}
            {chosenFlagged.length > 0 && (
              <Button size="sm" loading={bulkRunning} onClick={() => setBulkConfirm("clear_flags")}>
                Clear flags on {chosenFlagged.length}
              </Button>
            )}
            {/* Mixed selections are normal here, and each button says which slice it touches. */}
            {chosenReports.length > 0 && chosenFlagged.length > 0 && (
              <span className="text-xs text-muted">Each action applies to its own type only.</span>
            )}
          </BulkBar>
        </TabPanel>
      </Card>

      <ConfirmDialog
        open={bulkConfirm != null}
        title={bulkConfirm === "clear_flags" ? "Clear flags in bulk" : bulkConfirm === "resolved" ? "Resolve reports" : "Dismiss reports"}
        message={
          bulkConfirm === "clear_flags"
            ? `Clear AI flags on ${chosenFlagged.length} series? They leave the queue; moderation notes are kept.`
            : `Mark ${chosenReports.length} ${chosenReports.length === 1 ? "report" : "reports"} as ${bulkConfirm}? This cannot be undone from here.`
        }
        confirmLabel={bulkConfirm === "clear_flags" ? "Clear flags" : bulkConfirm === "resolved" ? "Resolve" : "Dismiss"}
        loading={bulkRunning}
        onConfirm={() => bulkConfirm && runBulk(bulkConfirm)}
        onCancel={() => setBulkConfirm(null)}
      />

      <ConfirmDialog
        open={confirm != null}
        title={confirm?.action === "unpublish" ? "Unpublish series" : "Clear moderation flags"}
        message={
          confirm?.action === "unpublish"
            ? `Move “${confirm.item.series_title ?? "this series"}” back to review? Viewers lose access until it is published again.`
            : `Clear the AI flags on “${confirm?.item.series_title ?? "this series"}”? It leaves the queue; the moderation note is kept.`
        }
        confirmLabel={confirm?.action === "unpublish" ? "Unpublish" : "Clear flags"}
        destructive={confirm?.action === "unpublish"}
        loading={confirm ? busy === confirm.item.id : false}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />

      {rating && (
        <RatingDialog
          item={rating}
          busy={busy === rating.id}
          onClose={() => setRating(null)}
          onSubmit={async (content_rating, note) => {
            const ok = await moderate(rating, { action: "set_rating", content_rating, note }, `Rated ${content_rating}`);
            if (ok) setRating(null);
          }}
        />
      )}
    </>
  );
}

function RatingDialog({
  item,
  busy,
  onClose,
  onSubmit,
}: {
  item: Item;
  busy: boolean;
  onClose: () => void;
  onSubmit: (rating: string, note: string | null) => void;
}) {
  const [value, setValue] = useState<string>("UA16");
  const [note, setNote] = useState(item.details ?? "");
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!value) {
      setError("Pick a rating.");
      return;
    }
    onSubmit(value, note.trim() || null);
  }

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!busy}
      title={`Set rating · ${item.series_title ?? "Series"}`}
      width="max-w-md"
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="rating-form" variant="primary" loading={busy}>
            Save rating
          </Button>
        </>
      }
    >
      <form id="rating-form" onSubmit={submit} className="grid gap-4" noValidate>
        <Field label="Content rating" required error={error ?? undefined} hint="A and UA16 require age confirmation before playback.">
          <Select
            data-autofocus
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
          >
            {CONTENT_RATINGS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.value} · {r.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Moderation note" hint="Replaces the note on the series; blank keeps the existing note.">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="min-h-16" />
        </Field>
        <p className="text-xs text-muted">
          Setting a rating does not clear the AI flags; use <em>Clear flags</em> once you have reviewed the series.
        </p>
      </form>
    </Modal>
  );
}
