"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { IconAlert, IconCheck, IconCoin, IconClose } from "@/components/ui/icons";

type Tone = "info" | "success" | "error" | "gold";
type Toast = { id: number; message: string; tone: Tone };

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => {});

/**
 * Tone is carried by an icon as well as a border. On near-black, `success` (#8ED1AE) and `danger` (#F09AA6) as
 * thin border colours are almost the same value, so a confirmation and a failure looked identical at a glance —
 * and a "+50 coins" reward looked like "Link copied".
 */
const tones: Record<Tone, { className: string; icon: ReactNode; accent: string }> = {
  info: { className: "border-line", icon: null, accent: "text-ink2" },
  success: { className: "border-success/50", icon: <IconCheck size={16} />, accent: "text-success" },
  error: { className: "border-danger/60", icon: <IconAlert size={16} />, accent: "text-danger" },
  gold: { className: "border-gold/60", icon: <IconCoin size={16} />, accent: "text-gold" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const push = useCallback(
    (message: string, tone: Tone = "info") => {
      const id = ++seq.current;
      setToasts((prev) => {
        const next = [...prev, { id, message, tone }];
        // Dropping the oldest also has to cancel its timer, or it fires later against an id that is gone.
        while (next.length > 4) {
          const evicted = next.shift();
          if (!evicted) break;
          const timer = timers.current.get(evicted.id);
          if (timer) clearTimeout(timer);
          timers.current.delete(evicted.id);
        }
        return next;
      });
      timers.current.set(id, setTimeout(() => dismiss(id), tone === "error" ? 6000 : 3500));
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      {/*
        Only the container is a live region. Marking each toast `role="status"` as well made some screen readers
        announce every message twice.

        Bottom-centre sat directly over the shorts action rail, the player controls and the mobile resume row, so
        on phones this rides above the bottom tab bar and moves to the top on the immersive surfaces.
      */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-[4.75rem] z-[80] flex flex-col items-center gap-2 px-4 md:bottom-4"
      >
        {toasts.map((t) => {
          const tone = tones[t.tone];
          return (
            <div
              key={t.id}
              className={`k-rise pointer-events-auto flex max-w-md items-center gap-2.5 rounded-md border bg-surface px-4 py-2.5 text-sm text-ink shadow-[var(--k-elevation-overlay)] ${tone.className}`}
            >
              {tone.icon && <span className={`shrink-0 ${tone.accent}`}>{tone.icon}</span>}
              <span className="flex-1">{t.message}</span>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="-me-1 shrink-0 rounded-sm p-1.5 text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
              >
                <IconClose size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
