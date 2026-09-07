"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, call } from "@/lib/api";
import { fmtCompact, fmtMoney, fmtNumber } from "@/lib/format";
import { useQuery } from "@/lib/use-query";
import {
  Card,
  EmptyState,
  ErrorState,
  InlineError,
  LoadingState,
  PageHeader,
  periodDelta,
  Select,
  StatTile,
  TabPanel,
  Table,
  Tabs,
  Td,
  Th,
} from "@/components/ui";
import { FunnelTab } from "./funnel-tab";
import { QualityTab } from "./quality-tab";

type DailyRow = { date: string; registrations: number; purchases: number; revenue: number };
type TopSeries = { id: string; title: string; views: number; unlocks: number };
type Tab = "overview" | "quality" | "funnel";

const RANGES = [7, 14, 30, 90, 180, 365];

export default function DashboardPage() {
  const tabsId = useId();
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <>
      <PageHeader title="Dashboard" description="Revenue, growth, playback quality and conversion." />
      <Tabs
        id={tabsId}
        label="Dashboard sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "overview", label: "Overview" },
          { value: "quality", label: "Quality" },
          { value: "funnel", label: "Funnel" },
        ]}
      />
      <TabPanel tabsId={tabsId} value={tab}>
        {tab === "overview" ? <OverviewTab /> : tab === "quality" ? <QualityTab /> : <FunnelTab />}
      </TabPanel>
    </>
  );
}

function OverviewTab() {
  const [days, setDays] = useState(30);
  const { data, loading, error, refetch } = useQuery(`dashboard:${days}`, () =>
    call(api.GET("/v1/admin/dashboard", { params: { query: { days } } })),
  );

  const daily = (data?.daily ?? []) as DailyRow[];
  const top = (data?.top_series ?? []) as TopSeries[];
  const revenueEntries = Object.entries(data?.revenue ?? {});
  const prev = data?.previous ?? null;
  // Deltas are against the window immediately before this one, of equal length. Running totals (total users,
  // published catalogue) deliberately get none: a percentage change on a cumulative figure means nothing.
  const vsPrevious = `vs previous ${data?.range_days ?? 0} days`;
  // Revenue is per currency; compare the one with the largest total rather than adding unlike currencies.
  const topCurrency = revenueEntries.slice().sort((a, b) => b[1] - a[1])[0]?.[0];
  const revenueDelta =
    topCurrency && prev ? periodDelta(data!.revenue[topCurrency] ?? 0, prev.revenue[topCurrency]) : null;

  return (
    <div className="flex flex-col gap-6 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Revenue, growth and engagement at a glance.</p>
        <label className="flex items-center gap-2 text-sm text-muted">
          Range
          <Select aria-label="Overview range" value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-36">
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
      ) : (
        <div className={`flex flex-col gap-6 ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            <StatTile
              label="Revenue"
              value={
                revenueEntries.length === 0 ? (
                  "—"
                ) : (
                  <span className="flex flex-col gap-0.5">
                    {revenueEntries.map(([cur, amt]) => (
                      <span key={cur}>{fmtMoney(amt, cur)}</span>
                    ))}
                  </span>
                )
              }
              sub={`${data.purchases_paid} paid purchases`}
              delta={revenueDelta}
              deltaLabel={topCurrency ? `${topCurrency} ${vsPrevious}` : vsPrevious}
            />
            <StatTile
              label="Paying users"
              value={fmtNumber(data.paying_users)}
              sub="unique buyers in range"
              delta={periodDelta(data.paying_users, prev?.paying_users)}
              deltaLabel={vsPrevious}
            />
            <StatTile
              label="New users"
              value={fmtNumber(data.new_users)}
              sub={`${fmtNumber(data.total_users)} total`}
              delta={periodDelta(data.new_users, prev?.new_users)}
              deltaLabel={vsPrevious}
            />
            <StatTile
              label="Active users"
              value={fmtNumber(data.active_users)}
              sub="seen in range"
              delta={periodDelta(data.active_users, prev?.active_users)}
              deltaLabel={vsPrevious}
            />
            <StatTile
              label="Unlocks"
              value={fmtNumber(data.unlocks)}
              sub={
                Object.keys(data.unlocks_by_method).length
                  ? Object.entries(data.unlocks_by_method)
                      .map(([m, n]) => `${m}: ${fmtNumber(n)}`)
                      .join(" · ")
                  : "none by method"
              }
              delta={periodDelta(data.unlocks, prev?.unlocks)}
              deltaLabel={vsPrevious}
            />
            <StatTile
              label="Coins spent"
              value={fmtCompact(data.coins_spent)}
              sub={fmtNumber(data.coins_spent)}
              delta={periodDelta(data.coins_spent, prev?.coins_spent)}
              deltaLabel={vsPrevious}
            />
            <StatTile label="Coins granted" value={fmtCompact(data.coins_granted)} sub={fmtNumber(data.coins_granted)} />
            <StatTile
              label="Published"
              value={fmtNumber(data.series_published)}
              sub={`${fmtNumber(data.episodes_published)} episodes`}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Daily registrations">
              <DailyChart rows={daily} dataKey="registrations" color="var(--accent)" />
            </Card>
            <Card title="Daily revenue">
              <DailyChart rows={daily} dataKey="revenue" color="var(--gold)" money />
            </Card>
          </div>

          <Card title={`Top series (${data.range_days} days)`}>
            {top.length === 0 ? (
              <EmptyState title="No published series yet" description="Top series appear once episodes are unlocked." />
            ) : (
              <Table minWidth={480}>
                <thead>
                  <tr>
                    <Th>#</Th>
                    <Th>Title</Th>
                    <Th className="text-right">Views</Th>
                    <Th className="text-right">Unlocks</Th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((s, i) => (
                    <tr key={s.id} className="hover:bg-surface-2/50">
                      <Td className="w-10 text-muted">{i + 1}</Td>
                      {/* The highest-leverage click on the page — go and fix or promote that series — did not
                          exist: the title was plain text. */}
                      <Td className="font-medium">
                        <Link href={`/dramas/${s.id}`} className="text-ink underline-offset-4 hover:text-accent hover:underline">
                          {s.title}
                        </Link>
                      </Td>
                      <Td className="text-right tabular-nums">{fmtNumber(s.views)}</Td>
                      <Td className="text-right tabular-nums">{fmtNumber(s.unlocks)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function DailyChart({
  rows,
  dataKey,
  color,
  money,
}: {
  rows: DailyRow[];
  dataKey: "registrations" | "revenue";
  color: string;
  money?: boolean;
}) {
  if (rows.length === 0) {
    return <EmptyState title="No data in range" />;
  }
  const gradId = `grad-${dataKey}`;
  return (
    <div className="h-64 px-2 py-3">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
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
            width={44}
            tickFormatter={(v: number) => fmtCompact(v)}
          />
          <Tooltip
            contentStyle={{ borderRadius: 8, border: "1px solid var(--line)", fontSize: 12 }}
            formatter={(v) => [money ? Number(v).toFixed(2) : fmtNumber(Number(v)), dataKey]}
          />
          <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#${gradId})`} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
