import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import "@/test/admin-pages-dom";
import { findCharts, hoverChart } from "@/test/admin-pages-chart";
import { fail, mockApi } from "@/test/api";
import { renderPage } from "@/test/render";
import { FunnelTab } from "./funnel-tab";

const ue = userEvent.setup();
const funnel = (steps: unknown[], range_days = 30) => ({ range_days, steps });
const calls = () => mockApi.callsTo("GET", "/v1/admin/analytics/funnel");

describe("FunnelTab", () => {
  it("shows each step with share of the top, share of the previous step and users dropped", async () => {
    mockApi.get(
      "/v1/admin/analytics/funnel",
      funnel([
        { name: "app_open", users: 1000 },
        { name: "series_view", users: 400 },
        { name: "mystery_step", users: 100 },
        { name: "paid", users: 0 },
      ]),
    );
    const { container } = renderPage(<FunnelTab />);
    expect(screen.getByText(/Loading…/)).toBeTruthy();
    await screen.findByText("Step detail");
    expect(calls()[0].query).toEqual({ days: "30" });
    expect(screen.getByText("Funnel (30 days)")).toBeTruthy();
    const rows = screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));
    expect(rows).toEqual([
      ["App open", "1,000", "100.0%", "—", "—"],
      ["Series viewed", "400", "40.0%", "40.0%", "600"],
      ["mystery step", "100", "10.0%", "25.0%", "300"], // unknown names fall back to a humanised label
      ["Purchase paid", "0", "0.0%", "0.0%", "100"],
    ]);
    const [chart] = await findCharts(container);
    expect(hoverChart(chart, 400, 40)).toMatch(/Users : 1,000/);
  });

  it("guards against a zero-user previous step", async () => {
    mockApi.get("/v1/admin/analytics/funnel", funnel([{ name: "app_open", users: 10 }, { name: "series_view", users: 0 }, { name: "play_start", users: 0 }]));
    renderPage(<FunnelTab />);
    await screen.findByText("Step detail");
    const last = screen.getAllByRole("row").at(-1)!;
    expect(within(last).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Playback started", "0", "0.0%", "0.0%", "0"]);
  });

  it("ignores malformed steps from the untyped API payload", async () => {
    mockApi.get(
      "/v1/admin/analytics/funnel",
      funnel([{ name: "app_open", users: "20" }, { users: 5 }, { name: "", users: 5 }, { name: "series_view", users: "abc" }, { name: "paid" }]),
    );
    renderPage(<FunnelTab />);
    await screen.findByText("Step detail");
    const names = screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[0].textContent);
    expect(names).toEqual(["App open", "Purchase paid"]); // string "20" is coerced; NaN/blank-name rows dropped; missing users => 0
  });

  it("explains an empty funnel, or one whose first step is zero", async () => {
    mockApi.get("/v1/admin/analytics/funnel", funnel([]));
    renderPage(<FunnelTab />);
    expect(await screen.findByText("No funnel data")).toBeTruthy();
    mockApi.get("/v1/admin/analytics/funnel", funnel([{ name: "app_open", users: 0 }]));
    await ue.selectOptions(screen.getByLabelText("Funnel range"), "7");
    await waitFor(() => expect(calls().at(-1)!.query.days).toBe("7"));
    expect(await screen.findByText("No funnel data")).toBeTruthy();
    expect(screen.queryByText("Step detail")).toBeNull();
  });

  it("treats a missing steps list as empty", async () => {
    mockApi.get("/v1/admin/analytics/funnel", { range_days: 30 });
    renderPage(<FunnelTab />);
    expect(await screen.findByText("No funnel data")).toBeTruthy();
  });

  it("surfaces errors, retries, and keeps stale data under an inline error", async () => {
    mockApi.get("/v1/admin/analytics/funnel", fail(500, "funnel down"));
    renderPage(<FunnelTab />);
    expect(await screen.findByText("funnel down")).toBeTruthy();
    mockApi.get("/v1/admin/analytics/funnel", funnel([{ name: "app_open", users: 3 }]));
    await ue.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Step detail");
    mockApi.get("/v1/admin/analytics/funnel", fail(500, "stale funnel"));
    await ue.selectOptions(screen.getByLabelText("Funnel range"), "365");
    expect(await screen.findByText("stale funnel")).toBeTruthy();
    expect(screen.getByText("Step detail")).toBeTruthy();
  });
});
