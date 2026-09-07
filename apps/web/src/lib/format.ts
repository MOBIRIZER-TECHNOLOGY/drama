/**
 * Prices. A whole amount prints without decimals: Indian consumer pricing is "₹99", never "₹99.00", and the
 * trailing paise read as an import and make the number feel larger than it is.
 */
export function formatMoney(amount: number, currency: string, locale: string = "en"): string {
  const whole = Number.isInteger(amount);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${whole ? amount : amount.toFixed(2)}`;
  }
}

/**
 * Counts. Compact notation above 10,000 keeps view counts readable.
 *
 * Never use this for a coin balance: `formatNumber` rounds, so 12,500 coins renders as "13K" and the app appears
 * to round the viewer's money up. `formatCoins` below is exact.
 */
export function formatNumber(n: number, locale: string = "en"): string {
  try {
    return new Intl.NumberFormat(locale, { notation: n >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(n);
  } catch {
    return String(n);
  }
}

/** A coin balance, grouped for the locale and never rounded. Money is always shown exactly. */
export function formatCoins(n: number, locale: string = "en"): string {
  try {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n);
  } catch {
    return String(n);
  }
}

export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

export function formatDate(iso: string | null | undefined, locale: string = "en"): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

export function formatRelative(iso: string | null | undefined, locale: string = "en"): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (d.getTime() - Date.now()) / 1000;
  if (!Number.isFinite(diff)) return "";
  const abs = Math.abs(diff);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    for (const [unit, secs] of units) {
      if (abs >= secs) return rtf.format(Math.round(diff / secs), unit);
    }
    return rtf.format(Math.round(diff), "second");
  } catch {
    return formatDate(iso, locale);
  }
}
