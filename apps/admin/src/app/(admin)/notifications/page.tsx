"use client";

import { useState, type FormEvent } from "react";
import { api, call, type Schemas } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useQuery } from "@/lib/use-query";
import { useToast } from "@/components/toast";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
} from "@/components/ui";

type Notification = Schemas["NotificationRow"];
type Audience = "all" | "locale";

/**
 * Announcements.
 *
 * The `notifications` table and the worker's `send_push` job both already existed and neither could be
 * reached: nothing in the product could write a row, so the job never had an argument and an operator had no
 * way to tell anyone anything. This is the half that was missing.
 *
 * Sending is deliberately behind a confirmation naming the audience. Everything else in this console edits a
 * record that can be edited back; this one reaches every active install at once and cannot be recalled.
 */
export default function NotificationsPage() {
  const toast = useToast();
  const { data, loading, error, refetch, setData } = useQuery("notifications", () =>
    call(api.GET("/v1/admin/notifications", { params: { query: { limit: 50 } } })),
  );

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<Audience>("all");
  const [locale, setLocale] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const ready = title.trim().length > 0 && body.trim().length > 0 && (audience === "all" || locale.trim().length > 0);

  const audienceLabel = audience === "all" ? "everyone active in the last 30 days" : `viewers using ${locale.trim() || "…"}`;

  const send = async () => {
    setBusy(true);
    try {
      const saved = await call(
        api.POST("/v1/admin/notifications", {
          body: {
            title: title.trim(),
            body: body.trim(),
            segment: audience === "all" ? { all: true } : { locale: locale.trim() },
          },
        }),
      );
      setData((prev) => [saved, ...(prev ?? [])]);
      setTitle("");
      setBody("");
      toast.success("Queued. Delivery counts appear once the worker has finished.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not queue the announcement");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (ready) setConfirming(true);
  };

  return (
    <>
      <PageHeader title="Notifications" description="Send a push announcement and see what happened to the last ones." />

      {/* Card carries no body padding of its own, because most of them hold a table. A form needs it. */}
      <Card>
        <form onSubmit={onSubmit} className="grid gap-4 p-5">
          <Field label="Title" hint="Shown in bold on the lock screen. Keep it under about 40 characters.">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="New episodes tonight" />
          </Field>
          <Field label="Message">
            <Input value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} placeholder="Three new episodes of The Heiress in Disguise at 8pm." />
          </Field>
          <Field label="Audience">
            <Select value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>
              <option value="all">Everyone active in the last 30 days</option>
              <option value="locale">One language</option>
            </Select>
          </Field>
          {audience === "locale" ? (
            <Field label="Language code" hint="Matches the viewer's saved language, e.g. hi or ta.">
              <Input value={locale} onChange={(e) => setLocale(e.target.value)} maxLength={8} placeholder="hi" />
            </Field>
          ) : null}
          <div>
            <Button type="submit" disabled={!ready || busy}>
              Send announcement
            </Button>
          </div>
        </form>
      </Card>

      <div className="mt-6">
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : (data?.length ?? 0) === 0 ? (
          <EmptyState title="Nothing sent yet" description="Announcements you send appear here with their delivery counts." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Title</Th>
                <Th>Audience</Th>
                <Th>Sent</Th>
                <Th>Delivered</Th>
                <Th>Failed</Th>
              </tr>
            </thead>
            <tbody>
              {data?.map((n: Notification) => (
                <tr key={n.id}>
                  <Td>
                    <div className="font-medium">{n.title}</div>
                    <div className="text-[var(--muted)] text-sm">{n.body}</div>
                  </Td>
                  <Td>{n.segment && "locale" in n.segment ? String(n.segment.locale) : "Everyone"}</Td>
                  {/* Queued but not yet sent is the normal state for a few seconds, and worth saying plainly. */}
                  <Td>{n.sent_at ? fmtDateTime(n.sent_at) : "Queued"}</Td>
                  <Td>{n.sent_at ? n.delivered : "—"}</Td>
                  <Td>{n.sent_at ? n.failed : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        title="Send to every device?"
        message={`"${title.trim()}" goes to ${audienceLabel}. A push cannot be recalled once it has left.`}
        confirmLabel="Send now"
        destructive
        loading={busy}
        onConfirm={send}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
