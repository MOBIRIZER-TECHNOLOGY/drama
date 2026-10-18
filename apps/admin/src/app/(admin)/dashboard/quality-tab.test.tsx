import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import "@/test/admin-pages-dom";
import { findCharts, hoverChart } from "@/test/admin-pages-chart";
import { fail, mockApi } from "@/test/api";
import { renderPage } from "@/test/render";
import { QualityTab } from "./quality-tab";

const ue = userEvent.setup();
const q = (date: string, platform: string | null, over: Record<string, unknown> = {}) => ({
  date,
  platform,
  plays: 100,
  p50_start_ms: 800,
  p95_start_ms: 2500,
  rebuffer_ratio: 0.05,
  error_rate: 0.01,
  ...over,
});
const calls = () => mockApi.callsTo("GET", "/v1/admin/analytics/qoe");
const cellsOf = () => screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));

describe("QualityTab", () => {
  it("shows play-weighted totals and a daily table sorted newest first, then platform", async () => {
    mockApi.get("/v1/admin/analytics/qoe", [
      q("2025-10-01", "web", { plays: 100, p50_start_ms: 500, p95_start_ms: 1000, rebuffer_ratio: 0.1, error_rate: 0 }),
      q("2025-10-02", "web", { plays: 300, p50_start_ms: 900, p95_start_ms: 3000, rebuffer_ratio: 0.3, error_rate: 0.06 }),
      q("2025-10-02", "android", { plays: 100, p50_start_ms: null, p95_start_ms: null, rebuffer_ratio: null, error_rate: null }),
      q("2025-10-02", null, { plays: 0, p50_start_ms: 1200, p95_start_ms: 2000, rebuffer_ratio: 0.02, error_rate: 0.02 }),
    ]);
    renderPage(<QualityTab />);
    expect(screen.getByText(/Loading…/)).toBeTruthy();
    await screen.findByText("Daily detail");
    expect(calls()[0].query).toEqual({ days: "14" });
    // newest first, then platform name (android < unknown < web)
    expect(cellsOf().map((c) => `${c[0]} ${c[1]}`)).toEqual(["2025-10-02 android", "2025-10-02 unknown", "2025-10-02 web", "2025-10-01 web"]);
    expect(cellsOf()[0]).toEqual(["2025-10-02", "android", "100", "—", "—", "—", "—"]);
    expect(cellsOf()[2]).toEqual(["2025-10-02", "web", "300", "900 ms", "3.00 s", "30.0%", "6.0%"]);
    const tile = (label: string) => screen.getByText(label, { selector: "p" }).parentElement!;
    expect(within(tile("Plays")).getByText("500")).toBeTruthy();
    expect(within(tile("Plays")).getByText("3 platform(s)")).toBeTruthy();
    // p50 = (500*100 + 900*300 + 1200*0) / 400 = 800 ; p95 = (1000*100 + 3000*300)/400 = 2500
    expect(within(tile("Start p50")).getByText("800 ms")).toBeTruthy();
    expect(within(tile("Start p95")).getByText("2.50 s")).toBeTruthy();
    // rebuffer = (0.1*100 + 0.3*300)/400 = 0.25 ; errors = (0*100 + 0.06*300)/400 = 0.045
    expect(within(tile("Rebuffer ratio")).getByText("25.0%")).toBeTruthy();
    expect(within(tile("Error rate")).getByText("4.5%")).toBeTruthy();
  });

  it("colours rebuffer and error rates by budget", async () => {
    mockApi.get("/v1/admin/analytics/qoe", [
      q("2025-10-03", "web", { rebuffer_ratio: 0.3, error_rate: 0.06 }),
      q("2025-10-02", "web", { rebuffer_ratio: 0.12, error_rate: 0.03 }),
      q("2025-10-01", "web", { rebuffer_ratio: 0.01, error_rate: 0.001 }),
    ]);
    renderPage(<QualityTab />);
    await screen.findByText("Daily detail");
    const rows = screen.getAllByRole("row").slice(1);
    const classOf = (r: HTMLElement, i: number) => within(r).getAllByRole("cell")[i].querySelector("span")!.className;
    expect(classOf(rows[0], 5)).toBe("text-danger");
    expect(classOf(rows[0], 6)).toBe("text-danger");
    expect(classOf(rows[1], 5)).toBe("text-warning");
    expect(classOf(rows[1], 6)).toBe("text-warning");
    expect(classOf(rows[2], 5)).toBe("text-ink-2");
    expect(classOf(rows[2], 6)).toBe("text-ink-2");
  });

  it("formats start-time values below and above one second, and shows em dashes when no totals exist", async () => {
    mockApi.get("/v1/admin/analytics/qoe", [q("2025-10-01", "ios", { plays: 10, p50_start_ms: 999.4, p95_start_ms: 1000, rebuffer_ratio: null, error_rate: null })]);
    renderPage(<QualityTab />);
    await screen.findByText("Daily detail");
    expect(cellsOf()[0].slice(3, 5)).toEqual(["999 ms", "1.00 s"]);
    const tile = (label: string) => screen.getByText(label, { selector: "p" }).parentElement!;
    expect(within(tile("Rebuffer ratio")).getByText("—")).toBeTruthy();
    expect(within(tile("Error rate")).getByText("—")).toBeTruthy();
  });

  it("charts one line per platform with the selected percentile and lists a legend", async () => {
    mockApi.get("/v1/admin/analytics/qoe", [
      q("2025-10-01", "web", { p50_start_ms: 400, p95_start_ms: 1500 }),
      q("2025-10-02", "web", { p50_start_ms: 600, p95_start_ms: 2500 }),
      q("2025-10-01", "android", { p50_start_ms: 700, p95_start_ms: 3500 }),
      q("2025-10-02", "weird", { p50_start_ms: 800, p95_start_ms: 4500 }),
    ]);
    const { container } = renderPage(<QualityTab />);
    await screen.findByText("Daily detail");
    await findCharts(container);
    expect(container.querySelectorAll(".recharts-line")).toHaveLength(3);
    const legend = screen.getByText("Start time by day").closest("section")!.querySelector(":scope > p")!;
    expect(legend.textContent).toBe("androidwebweird");
    const [wrapper] = await findCharts(container);
    // p95 by default: tooltip on the later day shows web 2.50 s
    expect(hoverChart(wrapper, 780)).toMatch(/web : 2\.50 s/);
    await ue.selectOptions(screen.getByLabelText("Start-time metric"), "p50_start_ms");
    expect(hoverChart((await findCharts(container))[0], 780)).toMatch(/web : 600 ms/);
    expect(container.querySelector(".recharts-yAxis")?.textContent).toMatch(/ms/);
  });

  it("changes the range", async () => {
    mockApi.get("/v1/admin/analytics/qoe", [q("2025-10-01", "web")]);
    renderPage(<QualityTab />);
    await screen.findByText("Daily detail");
    await ue.selectOptions(screen.getByLabelText("QoE range"), "60");
    await waitFor(() => expect(calls().at(-1)!.query.days).toBe("60"));
  });

  it("explains when no playback events exist", async () => {
    mockApi.get("/v1/admin/analytics/qoe", []);
    renderPage(<QualityTab />);
    expect(await screen.findByText("No playback events yet")).toBeTruthy();
  });

  it("surfaces errors, retries, and keeps stale data under an inline error", async () => {
    mockApi.get("/v1/admin/analytics/qoe", fail(500, "qoe down"));
    renderPage(<QualityTab />);
    expect(await screen.findByText("qoe down")).toBeTruthy();
    mockApi.get("/v1/admin/analytics/qoe", [q("2025-10-01", "web")]);
    await ue.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Daily detail");
    mockApi.get("/v1/admin/analytics/qoe", fail(500, "qoe stale"));
    await ue.selectOptions(screen.getByLabelText("QoE range"), "90");
    expect(await screen.findByText("qoe stale")).toBeTruthy();
    expect(screen.getByText("Daily detail")).toBeTruthy();
  });
});
