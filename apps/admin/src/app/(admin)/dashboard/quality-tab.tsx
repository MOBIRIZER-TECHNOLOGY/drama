"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, call, type Schemas } from "@/lib/api";
import { fmtNumber } from "@/lib/format";
import { useQuery } from "@/lib/use-query";
import { Card, EmptyState, ErrorState, InlineError, LoadingState, Select, StatTile, Table, Td, Th } from "@/components/ui";

type QoeRow = Schemas["QoeRow"];

const RANGES = [7, 14, 30, 60, 90];
/** One line colour per platform; anything else falls back to the muted ramp. */
const PLATFORM_COLORS: Record<string, string> = {
  web: "var(--accent)",
  android: "var(--gold)",
  ios: "var(--success)",
};
const UNKNOWN_PLATFORM = "unknown";

function platformOf(row: QoeRow): string {
  return row.platform ?? UNKNOWN_PLATFORM;
}

function fmtMs(v: number | null | undefined): string {
  if (v == null) return "—";
  return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;
}

function fmtPct(v: number | null | undefined): string {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}

/** Percentage cell that turns amber/red once the ratio passes the usual QoE budgets. */
function RateCell({ value, warn, bad }: { value: number | null; warn: number; bad: number }) {
  if (value == null) return <span className="text-muted">—</span>;
  const tone = value >= bad ? "text-danger" : value >= warn ? "text-warning" : "text-ink-2";
  return <span className={tone}>{fmtPct(value)}</span>;
}

export function QualityTab() {
  const [days, setDays] = useState(14);
  const [metric, setMetric] = useState<"p50_start_ms" | "p95_start_ms">("p95_start_ms");
  const { data, loading, error, refetch } = useQuery(`qoe:${days}`, () =>
    call(api.GET("/v1/admin/analytics/qoe", { params: { query: { days } } })),
  );

  const rows = useMemo(() => [...(data ?? [])].sort((a, b) => b.date.localeCompare(a.date) || platformOf(a).localeCompare(platformOf(b))), [data]);
  const platforms = useMemo(() => [...new Set(rows.map(platformOf))].sort(), [rows]);

  // One point per day, one series per platform, oldest first so the line reads left to right.
  const series = useMemo(() => {
    const byDate = new Map<string, Record<string, number | string | null>>();
    for (const r of rows) {
      const point = byDate.get(r.date) ?? { date: r.date };
      point[platformOf(r)] = r[metric];
      byDate.set(r.date, point);
    }
    return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [rows, metric]);

  const totals = useMemo(() => {
    const plays = rows.reduce((n, r) => n + r.plays, 0);
    const weighted = (pick: (r: QoeRow) => number | null) => {
      let sum = 0;
      let seen = 0;
      for (const r of rows) {
        const v = pick(r);
        if (v != null) {
          sum += v * r.plays;
          seen += r.plays;
        }
      }
      return seen ? sum / seen : null;
    };
    return {
      plays,
      p50: weighted((r) => r.p50_start_ms),
      p95: weighted((r) => r.p95_start_ms),
      rebuffer: weighted((r) => r.rebuffer_ratio),
      errors: weighted((r) => r.error_rate),
    };
  }, [rows]);

  return (
    <div className="flex flex-col gap-6 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Playback quality from client analytics: time to first frame, rebuffering and errors, per platform per day.
        </p>
        <label className="flex items-center gap-2 text-sm text-muted">
          Range
          <Select aria-label="QoE range" value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-36">
            {RANGES.map((r) => (
              <option key={r} value={r}>
                Last {r} days
              </option>
            ))}
          </Select>
        </label>
      </div>

      {error && data && <InlineError message={error} onRetry={refetch} />}
      {error && !data ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : !data ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState title="No playback events yet" description="Quality metrics appear once the apps report first_frame, rebuffer and play_error events." />
        </Card>
      ) : (
        <div className={`flex flex-col gap-6 ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <StatTile label="Plays" value={fmtNumber(totals.plays)} sub={`${platforms.length} platform(s)`} />
            <StatTile label="Start p50" value={fmtMs(totals.p50)} sub="play-weighted" />
            <StatTile label="Start p95" value={fmtMs(totals.p95)} sub="play-weighted" />
            <StatTile label="Rebuffer ratio" value={fmtPct(totals.rebuffer)} sub="rebuffers per play" />
            <StatTile label="Error rate" value={fmtPct(totals.errors)} sub="play errors per play" />
          </div>

          <Card
            title="Start time by day"
            actions={
              <Select
                aria-label="Start-time metric"
                value={metric}
                onChange={(e) => setMetric(e.target.value as typeof metric)}
                className="h-8 w-32 text-[13px]"
              >
                <option value="p50_start_ms">p50</option>
                <option value="p95_start_ms">p95</option>
              </Select>
            }
          >
            <div className="h-72 px-2 py-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--line)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "var(--muted)" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(d: string) => d.slice(5)}
                    minTickGap={24}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "var(--muted)" }}
                    tickLine={false}
                    axisLine={false}
                    width={56}
                    tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`)}
                  />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: "1px solid var(--line)", fontSize: 12 }}
                    formatter={(v, name) => [fmtMs(Number(v)), String(name)]}
                  />
                  {platforms.map((p) => (
                    <Line
                      key={p}
                      type="monotone"
                      dataKey={p}
                      name={p}
                      stroke={PLATFORM_COLORS[p] ?? "var(--muted)"}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="border-t border-line px-4 py-2 text-xs text-muted">
              {platforms.map((p) => (
                <span key={p} className="mr-4 inline-flex items-center gap-1.5">
                  <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: PLATFORM_COLORS[p] ?? "var(--muted)" }} />
                  {p}
                </span>
              ))}
            </p>
          </Card>

          <Card title="Daily detail">
            <Table minWidth={760}>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Platform</Th>
                  <Th className="text-right">Plays</Th>
                  <Th className="text-right">Start p50</Th>
                  <Th className="text-right">Start p95</Th>
                  <Th className="text-right">Rebuffer</Th>
                  <Th className="text-right">Errors</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.date}:${platformOf(r)}`} className="hover:bg-surface-2/50">
                    <Td className="whitespace-nowrap tabular-nums">{r.date}</Td>
                    <Td>{platformOf(r)}</Td>
                    <Td className="text-right tabular-nums">{fmtNumber(r.plays)}</Td>
                    <Td className="text-right tabular-nums">{fmtMs(r.p50_start_ms)}</Td>
                    <Td className="text-right tabular-nums">{fmtMs(r.p95_start_ms)}</Td>
                    <Td className="text-right tabular-nums">
                      <RateCell value={r.rebuffer_ratio} warn={0.1} bad={0.25} />
                    </Td>
                    <Td className="text-right tabular-nums">
                      <RateCell value={r.error_rate} warn={0.02} bad={0.05} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      )}
    </div>
  );
}
