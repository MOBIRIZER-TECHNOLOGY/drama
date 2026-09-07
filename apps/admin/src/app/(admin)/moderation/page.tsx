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
  Select,
  TabPanel,
  Tabs,
  Table,
  Td,
  Textarea,
  Th,
  statusTone,
} from "@/components/ui";

type Item = Schemas["ModerationItem"];
type Filter = "all" | "report" | "flagged_series";

export default function ModerationPage() {
  const toast = useToast();
  const tabsId = useId();
  const [filter, setFilter] = useState<Filter>("all");
  const { data, loading, error, refetch, setData } = useQuery("moderation", () => call(api.GET("/v1/admin/moderation")));
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ item: Item; action: "unpublish" | "clear_flags" } | null>(null);
  const [rating, setRating] = useState<Item | null>(null);

  const items = (data ?? []).filter((i) => filter === "all" || i.kind === filter).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const counts = { report: (data ?? []).filter((i) => i.kind === "report").length, flagged: (data ?? []).filter((i) => i.kind === "flagged_series").length };

  async function resolveReport(item: Item, status: "resolved" | "dismissed") {
    setBusy(item.id);
    setData((prev) => (prev ?? []).filter((x) => x.id !== item.id));
    try {
      await call(api.PUT("/v1/admin/reports/{report_id}", { params: { path: { report_id: item.id } }, body: { status } }));
      toast.success(`Report ${status}`);
    } catch (e) {
      setData((prev) => [item, ...(prev ?? [])]);
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
      if (body.action === "clear_flags") setData((prev) => (prev ?? []).filter((x) => x.id !== item.id));
      else refetch();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
      return false;
    } finally {
      setBusy(null);
    }
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
            onChange={setFilter}
            tabs={[
              { value: "all", label: "All", badge: data ? <Badge>{data.length}</Badge> : undefined },
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
        </TabPanel>
      </Card>

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
