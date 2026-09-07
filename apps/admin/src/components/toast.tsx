"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

type Kind = "success" | "error" | "info";
type Action = { label: string; onClick: () => void };
type Toast = { id: number; kind: Kind; message: string; action?: Action };
type Options = { action?: Action; durationMs?: number };

type ToastApi = {
  success: (message: string, opts?: Options) => void;
  error: (message: string, opts?: Options) => void;
  info: (message: string, opts?: Options) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const push = useCallback(
    (kind: Kind, message: string, opts?: Options) => {
      const id = ++seq.current;
      setToasts((t) => [...t.slice(-4), { id, kind, message, action: opts?.action }]);
      const ttl = opts?.durationMs ?? (kind === "error" ? 7000 : opts?.action ? 8000 : 4000);
      window.setTimeout(() => dismiss(id), ttl);
    },
    [dismiss],
  );

  const value = useMemo<ToastApi>(
    () => ({
      success: (m, o) => push("success", m, o),
      error: (m, o) => push("error", m, o),
      info: (m, o) => push("info", m, o),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(92vw,380px)] flex-col gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={`toast-in pointer-events-auto flex items-start gap-3 rounded-card border bg-surface px-4 py-3 text-sm shadow-none ${
              t.kind === "error"
                ? "border-danger/40 text-danger"
                : t.kind === "success"
                  ? "border-success/40 text-ink"
                  : "border-line-strong text-ink"
            }`}
          >
            <span
              aria-hidden
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                t.kind === "error" ? "bg-danger" : t.kind === "success" ? "bg-success" : "bg-accent"
              }`}
            />
            <span className="flex-1 break-words">{t.message}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
                className="shrink-0 font-medium text-accent underline-offset-2 hover:underline"
              >
                {t.action.label}
              </button>
            )}
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="text-muted hover:text-ink">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
