"use client";

import Link from "next/link";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useHref, useT } from "@/lib/app-context";
import type { CategoryOut } from "@/lib/types";
import { IconClock, IconClose, IconSearch } from "./ui/icons";

const KEY = "katha.recent_searches";
const MAX = 8;

/**
 * Recent searches live in localStorage, which is external state, so it is subscribed to rather than mirrored
 * into a state variable. The snapshot is the raw string precisely because it is referentially stable — parsing
 * in the snapshot would return a new array every render and loop.
 */
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // Another tab clearing history should update this one too.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function snapshot(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "[]";
  } catch {
    // Private mode, cleared storage, or a browser refusing site data: no history is a fine outcome.
    return "[]";
  }
}

const serverSnapshot = () => "[]";

function parse(raw: string): string[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/** Record a query the viewer actually ran. Called from the results page, so a half-typed term is not stored. */
export function rememberSearch(term: string): void {
  const q = term.trim();
  if (!q || typeof window === "undefined") return;
  try {
    const next = [q, ...parse(snapshot()).filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
    emit();
  } catch {
    /* nothing to store into */
  }
}

/**
 * What to offer on the search screen before anything is typed.
 *
 * "Type something to search" is a blank wall on the one screen with the highest intent in the product. Recent
 * queries come from this browser; the genre chips come from the catalogue, so a viewer who does not know a
 * title still has somewhere to go.
 */
export function SearchSuggestions({ categories }: { categories: CategoryOut[] }) {
  const t = useT();
  const href = useHref();
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const recent = useMemo(() => parse(raw), [raw]);

  const clear = useCallback(() => {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* already gone */
    }
    emit();
  }, []);

  return (
    <div className="flex flex-col gap-8">
      {recent.length > 0 && (
        <section aria-labelledby="recent-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="recent-heading" className="font-display text-lg font-semibold text-ink">
              {t("search.recent", "Recent searches")}
            </h2>
            <button type="button" onClick={clear} className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline">
              {t("search.clear_recent", "Clear")}
            </button>
          </div>
          <ul className="flex flex-wrap gap-2">
            {recent.map((q) => (
              <li key={q}>
                <Link
                  href={`${href("/search")}?q=${encodeURIComponent(q)}`}
                  className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-surface px-3 py-1.5 text-sm text-ink2 hover:border-muted/60 hover:text-ink"
                >
                  <IconClock size={13} className="text-muted" />
                  {q}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {categories.length > 0 && (
        <section aria-labelledby="browse-heading">
          <h2 id="browse-heading" className="mb-3 font-display text-lg font-semibold text-ink">
            {t("search.browse_genres", "Or browse by genre")}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <li key={c.id}>
                <Link
                  href={href(`/category/${c.slug}`)}
                  className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-surface px-3 py-1.5 text-sm text-ink2 hover:border-muted/60 hover:text-ink"
                >
                  <IconSearch size={13} className="text-muted" />
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recent.length === 0 && categories.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <IconClose size={14} />
          {t("search.empty_message", "Try a title, a genre or a mood.")}
        </p>
      )}
    </div>
  );
}
