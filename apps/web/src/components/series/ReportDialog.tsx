"use client";

import { useState } from "react";
import { useT } from "@/lib/app-context";
import { clientApi } from "@/lib/client-api";
import { call } from "@/lib/errors";
import { useToast } from "@/lib/toast";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field, inputClass } from "../ui/states";

const REASONS = ["inappropriate", "copyright", "playback_issue", "wrong_subtitles", "other"] as const;

export function ReportDialog({
  open,
  onClose,
  seriesId,
  episodeId,
}: {
  open: boolean;
  onClose: () => void;
  seriesId: string;
  episodeId: string | null;
}) {
  const t = useT();
  const toast = useToast();
  const [reason, setReason] = useState<(typeof REASONS)[number]>("playback_issue");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const labels: Record<(typeof REASONS)[number], string> = {
    inappropriate: t("report.inappropriate", "Inappropriate content"),
    copyright: t("report.copyright", "Copyright issue"),
    playback_issue: t("report.playback", "Video does not play"),
    wrong_subtitles: t("report.subtitles", "Wrong language or subtitles"),
    other: t("report.other", "Something else"),
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    const { error } = await call(() =>
      clientApi.POST("/v1/reports", { body: { series_id: seriesId, episode_id: episodeId, reason, details: details.trim() || null } }),
    );
    setBusy(false);
    if (error) return setError(error.message);
    toast(t("report.thanks", "Thanks, we will look into it."), "success");
    setDetails("");
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title={t("report.title", "Report a problem")} size="sm" closeLabel={t("common.close", "Close")}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-3"
      >
        <Field label={t("report.reason", "Reason")} htmlFor="report-reason">
          <select id="report-reason" value={reason} onChange={(e) => setReason(e.target.value as (typeof REASONS)[number])} className={inputClass}>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {labels[r]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("report.details", "Details (optional)")} htmlFor="report-details">
          <textarea
            id="report-details"
            rows={3}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            className={`${inputClass} h-auto py-2`}
            maxLength={1000}
          />
        </Field>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" loading={busy} className="w-full">
          {t("report.submit", "Send report")}
        </Button>
      </form>
    </Dialog>
  );
}
