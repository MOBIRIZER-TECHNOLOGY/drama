"use client";

import { useState } from "react";
import { api, call, type Schemas } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useQuery } from "@/lib/use-query";
import { Icon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, LoadingState, PageHeader, Toggle, InlineError } from "@/components/ui";

type Message = Schemas["AdminContactOut"];

export default function InboxPage() {
  const toast = useToast();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, loading, error, refetch, setData } = useQuery(`inbox:${unreadOnly}`, () =>
    call(api.GET("/v1/admin/inbox", { params: { query: { unread_only: unreadOnly, limit: 200 } } })),
  );

  async function markRead(m: Message) {
    if (m.is_read) return;
    setData((prev) => (prev ?? []).map((x) => (x.id === m.id ? { ...x, is_read: true } : x)));
    try {
      await call(api.PUT("/v1/admin/inbox/{message_id}/read", { params: { path: { message_id: m.id } } }));
    } catch (e) {
      setData((prev) => (prev ?? []).map((x) => (x.id === m.id ? { ...x, is_read: false } : x)));
      toast.error(e instanceof Error ? e.message : "Could not mark as read");
    }
  }

  function toggle(m: Message) {
    const next = openId === m.id ? null : m.id;
    setOpenId(next);
    if (next) void markRead(m);
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    const victim = deleting;
    try {
      await call(api.DELETE("/v1/admin/inbox/{message_id}", { params: { path: { message_id: victim.id } } }));
      toast.success("Message deleted");
      setDeleting(null);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  const unread = (data ?? []).filter((m) => !m.is_read).length;

  return (
    <>
      <PageHeader
        title="Inbox"
        description={data ? `${unread} unread of ${data.length}` : "Messages from the contact form."}
        actions={<Toggle label="Unread only" checked={unreadOnly} onChange={setUnreadOnly} />}
      />
      <Card>
        {error && data && <InlineError message={error} onRetry={refetch} />}
        {error && !data ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : !data ? (
          <LoadingState />
        ) : data.length === 0 ? (
          <EmptyState title={unreadOnly ? "No unread messages" : "Inbox is empty"} />
        ) : (
          <ul className={loading ? "opacity-70" : undefined}>
            {data.map((m) => {
              const open = openId === m.id;
              return (
                <li key={m.id} className="border-b border-line last:border-b-0">
                  <div className="flex items-start gap-3 px-4 py-3">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => toggle(m)}
                      className="flex min-w-0 flex-1 items-start gap-3 text-left"
                    >
                      <span aria-hidden className={`mt-2 h-2 w-2 shrink-0 rounded-full ${m.is_read ? "bg-transparent" : "bg-accent"}`} />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline gap-x-2">
                          <span className={`truncate ${m.is_read ? "font-medium text-ink-2" : "font-semibold text-ink"}`}>{m.name}</span>
                          <span className="truncate text-xs text-muted">{m.email}</span>
                          {m.replied_at && <Badge tone="success">replied</Badge>}
                        </span>
                        <span className="block truncate text-sm text-ink-2">{m.subject || m.message.slice(0, 100)}</span>
                      </span>
                      <span className="shrink-0 whitespace-nowrap text-xs text-muted">{fmtDateTime(m.created_at)}</span>
                    </button>
                    <Button size="sm" variant="ghost" aria-label={`Delete message from ${m.name}`} onClick={() => setDeleting(m)}>
                      <Icon name="trash" size={14} className="text-danger" />
                    </Button>
                  </div>
                  {open && (
                    <div className="px-4 pb-4 pl-9">
                      <p className="whitespace-pre-wrap rounded-lg bg-surface-2/60 p-3 text-sm text-ink">{m.message}</p>
                      <div className="mt-2 flex gap-2">
                        <a href={`mailto:${m.email}?subject=${encodeURIComponent(`Re: ${m.subject ?? "your message"}`)}`} className="text-sm text-accent hover:underline">
                          Reply by email
                        </a>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        open={deleting != null}
        title="Delete message"
        message={`Delete the message from ${deleting?.name ?? ""}? This cannot be undone.`}
        loading={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
