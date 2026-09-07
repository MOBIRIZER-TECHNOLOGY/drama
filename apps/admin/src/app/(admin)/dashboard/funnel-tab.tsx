"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, call } from "@/lib/api";
import { fmtNumber } from "@/lib/format";
import { useQuery } from "@/lib/use-query";
import { Card, EmptyState, ErrorState, InlineError, LoadingState, Select, Table, Td, Th } from "@/components/ui";

const RANGES = [7, 14, 30, 90, 180, 365];

/** `FunnelOut.steps` is `list[dict]` in the API, so the row shape is asserted here. */
type Step = { name: string; users: number };

const STEP_LABELS: Record<string, string> = {
  app_open: "App open",
  series_view: "Series viewed",
  play_start: "Playback started",
  paywall_view: "Paywall seen",
  unlock: "Episode unlocked",
  checkout_start: "Checkout started",
  paid: "Purchase paid",
};

function toSteps(raw: { [key: string]: unknown }[] | undefined): Step[] {
  return (raw ?? [])
    .map((s) => ({ name: String(s.name ?? ""), users: Number(s.users ?? 0) }))
    .filter((s) => s.name.length > 0 && Number.isFinite(s.users));
}

export function FunnelTab() {
  const [days, setDays] = useState(30);
  const { data, loading, error, refetch } = useQuery(`funnel:${days}`, () =>
    call(api.GET("/v1/admin/analytics/funnel", { params: { query: { days } } })),
  );

  const steps = useMemo(() => toSteps(data?.steps), [data]);
  const top = steps[0]?.users ?? 0;

  const rows = useMemo(
    () =>
      steps.map((s, i) => {
        const prev = i === 0 ? null : steps[i - 1].users;
        return {
          ...s,
          label: STEP_LABELS[s.name] ?? s.name.replace(/_/g, " "),
          ofTop: top > 0 ? s.users / top : 0,
          ofPrev: prev == null ? null : prev > 0 ? s.users / prev : 0,
          dropped: prev == null ? null : Math.max(0, prev - s.users),
        };
      }),
    [steps, top],
  );

  return (
    <div className="flex flex-col gap-6 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Unique users (or sessions, when signed out) reaching each step. Steps are counted independently, so a user can appear in a later step without the earlier one.
        </p>
        <label className="flex items-center gap-2 text-sm text-muted">
          Range
          <Select aria-label="Funnel range" value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-36">
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
      ) : rows.length === 0 || top === 0 ? (
        <Card>
          <EmptyState title="No funnel data" description="Steps appear once the apps report analytics events in this range." />
        </Card>
      ) : (
        <div className={`flex flex-col gap-6 ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
          <Card title={`Funnel (${data.range_days} days)`}>
            <div className="px-2 py-3" style={{ height: Math.max(240, rows.length * 44 + 40) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 48, bottom: 0, left: 8 }}>
                  <CartesianGrid stroke="var(--line)" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: "var(--muted)" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => fmtNumber(v)}
                    allowDecimals={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    tick={{ fontSize: 12, fill: "var(--ink-2)" }}
                    tickLine={false}
                    axisLine={false}
                    width={130}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--surface-2)" }}
                    contentStyle={{ borderRadius: 8, border: "1px solid var(--line)", fontSize: 12 }}
                    formatter={(v) => [fmtNumber(Number(v)), "Users"]}
                  />
                  <Bar dataKey="users" radius={[0, 4, 4, 0]} barSize={22}>
                    {rows.map((r, i) => (
                      // Fade down the funnel so the drop-off reads at a glance.
                      <Cell key={r.name} fill="var(--accent)" fillOpacity={1 - (i / Math.max(1, rows.length)) * 0.55} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Step detail">
            <Table minWidth={620}>
              <thead>
                <tr>
                  <Th>Step</Th>
                  <Th className="text-right">Users</Th>
                  <Th className="text-right">% of first step</Th>
                  <Th className="text-right">% of previous</Th>
                  <Th className="text-right">Dropped</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} className="hover:bg-surface-2/50">
                    <Td className="font-medium capitalize">{r.label}</Td>
                    <Td className="text-right tabular-nums">{fmtNumber(r.users)}</Td>
                    <Td className="text-right tabular-nums">{(r.ofTop * 100).toFixed(1)}%</Td>
                    <Td className="text-right tabular-nums">{r.ofPrev == null ? "—" : `${(r.ofPrev * 100).toFixed(1)}%`}</Td>
                    <Td className="text-right tabular-nums text-muted">{r.dropped == null ? "—" : fmtNumber(r.dropped)}</Td>
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
