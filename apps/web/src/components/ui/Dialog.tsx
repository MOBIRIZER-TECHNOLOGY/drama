"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { useT } from "@/lib/app-context";
import { IconClose } from "./icons";

/** Accessible modal built on the native <dialog> element (focus trap, Esc, backdrop click). */
export function Dialog({
  open,
  onClose,
  title,
  children,
  size = "md",
  closeLabel,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  size?: "sm" | "md" | "lg";
  closeLabel?: string;
}) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const width = size === "sm" ? "max-w-sm" : size === "lg" ? "max-w-2xl" : "max-w-md";

  const titleId = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={title ? titleId : undefined}
      // Any native close (Esc, form method=dialog, programmatic) syncs React state.
      onClose={() => {
        if (open) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={`m-auto w-[calc(100%-2rem)] ${width} rounded-lg border border-line bg-surface p-0 text-ink open:animate-[k-pop_.18s_ease-out]`}
    >
      <div className="flex max-h-[85vh] flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 id={titleId} className="font-display text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel ?? t("common.close", "Close")}
            className="rounded-pill p-1.5 text-muted hover:bg-surface2 hover:text-ink"
          >
            <IconClose size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </dialog>
  );
}
