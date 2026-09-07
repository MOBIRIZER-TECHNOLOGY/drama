"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, call } from "@/lib/api";
import { NAV, canAccess, type Role } from "@/lib/nav";
import { seriesTitle } from "@/lib/series";

type Command = { id: string; label: string; hint?: string; href: string; group: string };

/**
 * Global search and navigation, on Ctrl/Cmd+K.
 *
 * The console has eighteen destinations plus several hundred series and thousands of users, and reaching any of
 * them meant walking a sidebar list with a mouse. This collapses the common three-to-five-click navigations to
 * one, and searches the catalogue and the user list as you type.
 *
 * Remote results are debounced and keyed by the query they belong to, so a slow response for "rev" can never
 * overwrite the results for "revenge".
 */
export function CommandPalette({ role }: { role: Role }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<Command[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const latest = useRef("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Static destinations, filtered by what this role can actually reach.
  const routes = useMemo<Command[]>(
    () =>
      NAV.filter((item) => !item.hidden && canAccess(role, item.href)).map((item) => ({
        id: `nav:${item.href}`,
        label: item.label,
        href: item.href,
        group: item.section,
      })),
    [role],
  );

  const search = useCallback(
    async (q: string) => {
      latest.current = q;
      if (q.trim().length < 2) {
        setRemote([]);
        return;
      }
      const [series, users] = await Promise.all([
        call(api.GET("/v1/admin/series", { params: { query: { q, limit: 5 } } })).catch(() => null),
        canAccess(role, "/users")
          ? call(api.GET("/v1/admin/users", { params: { query: { q, limit: 5 } } })).catch(() => null)
          : Promise.resolve(null),
      ]);
      // A late response for an earlier query must not replace the current one.
      if (latest.current !== q) return;
      setRemote([
        ...(series ?? []).map((s) => ({
          id: `series:${s.id}`,
          label: seriesTitle(s),
          hint: s.status,
          href: `/dramas/${s.id}`,
          group: "Series",
        })),
        ...(users?.items ?? []).map((u) => ({
          id: `user:${u.id}`,
          label: u.display_name || u.email || u.public_id,
          hint: u.public_id,
          href: `/users?user=${u.id}`,
          group: "Users",
        })),
      ]);
    },
    [role],
  );

  useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => void search(query), 220);
    return () => clearTimeout(handle);
  }, [query, open, search]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q ? routes.filter((r) => r.label.toLowerCase().includes(q)) : routes;
    return [...matched, ...remote].slice(0, 20);
  }, [routes, remote, query]);

  const go = useCallback(
    (command: Command) => {
      setOpen(false);
      setQuery("");
      setRemote([]);
      router.push(command.href);
    },
    [router],
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && results[active]) {
              e.preventDefault();
              go(results[active]);
            }
          }}
          placeholder="Search screens, series and users…"
          aria-label="Search screens, series and users"
          className="w-full border-b border-line bg-transparent px-4 py-3 text-sm text-ink outline-none placeholder:text-muted"
        />
        <ul className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-muted">No matches</li>
          ) : (
            results.map((command, i) => (
              <li key={command.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(command)}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${
                    i === active ? "bg-surface-2 text-ink" : "text-ink-2"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{command.label}</span>
                  {command.hint && <span className="shrink-0 text-xs text-muted">{command.hint}</span>}
                  <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted">{command.group}</span>
                </button>
              </li>
            ))
          )}
        </ul>
        <p className="border-t border-line px-4 py-2 text-[11px] text-muted">
          ↑↓ to move · Enter to open · Esc to close
        </p>
      </div>
    </div>
  );
}
