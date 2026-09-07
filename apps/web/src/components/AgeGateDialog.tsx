"use client";

import { useT } from "@/lib/app-context";
import { Button } from "./ui/Button";
import { Dialog } from "./ui/Dialog";
import { IconAlert } from "./ui/icons";

/**
 * Adult-rated series: the API answers `age_gate_required` until the account confirms its age.
 * Confirming calls `PATCH /v1/auth/me {age_confirmed: true}`; the caller retries the blocked action.
 */
export function AgeGateDialog({
  open,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      closeLabel={t("common.close", "Close")}
      title={
        <span className="inline-flex items-center gap-2">
          <IconAlert size={18} className="text-warning" />
          {t("age_gate.title", "Mature content")}
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink2">
          {t("age_gate.message", "This drama is rated for adults. Confirm your age to continue watching.")}
        </p>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button size="lg" loading={busy} onClick={onConfirm} className="w-full">
          {t("age_gate.confirm", "I am 18 or older")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={busy} className="w-full">
          {t("age_gate.cancel", "Not now")}
        </Button>
        <p className="text-center text-xs text-muted">
          {t("age_gate.note", "We store only the confirmation on your account, nothing else.")}
        </p>
      </div>
    </Dialog>
  );
}
