export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatMoney(amount: number, currency: string, symbol?: string): string {
  const value = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return symbol ? `${symbol}${value}` : `${currency} ${value}`;
}

/**
 * Share link for a series, optionally pointing at the exact episode the sharer was watching.
 *
 * `/s/{slug}` is the short form the web now 308s to the canonical series page. Carrying `ep` matters: a share
 * without it drops the recipient at episode 1 and loses the cliffhanger that made someone share in the first
 * place. `utm_source=share` lets the funnel tell organic shares from everything else.
 */
export function seriesShareUrl(slug: string, opts?: { episode?: number; ref?: string | null }): string {
  const params = new URLSearchParams({ utm_source: "share" });
  if (opts?.episode && opts.episode > 1) params.set("ep", String(opts.episode));
  if (opts?.ref) params.set("ref", opts.ref);
  return `https://katha.app/s/${slug}?${params.toString()}`;
}
