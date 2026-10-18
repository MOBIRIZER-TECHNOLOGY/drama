import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import "@/test/admin-pages-dom";
import { fail, mockApi } from "@/test/api";
import { findCharts, hoverChart } from "@/test/admin-pages-chart";
import { renderPage } from "@/test/render";
import DashboardPage from "./page";

const ue = userEvent.setup();

const overview = (over: Record<string, unknown> = {}) => ({
  range_days: 30,
  revenue: { INR: 1500, USD: 20 },
  purchases_paid: 12,
  paying_users: 9,
  new_users: 100,
  total_users: 5000,
  active_users: 800,
  unlocks: 300,
  unlocks_by_method: { coins: 250, ad: 50 },
  coins_spent: 12345,
  coins_granted: 2000000,
  series_published: 20,
  episodes_published: 400,
  daily: [
    { date: "2025-10-01", registrations: 5, purchases: 1, revenue: 10 },
    { date: "2025-10-02", registrations: 7, purchases: 2, revenue: 25 },
  ],
  top_series: [{ id: "s1", title: "The Heiress", views: 12000, unlocks: 345 }],
  previous: { revenue: { INR: 1000 }, paying_users: 10, new_users: 100, active_users: 400, unlocks: 0, coins_spent: 12345 },
  ...over,
});

describe("DashboardPage overview", () => {
  it("renders stat tiles with period deltas, the top-series table and charts", async () => {
    mockApi.get("/v1/admin/dashboard", overview());
    const { container } = renderPage(<DashboardPage />);
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeTruthy();
    expect(screen.getByText(/Loading…/)).toBeTruthy();
    await screen.findByText("The Heiress");
    expect(mockApi.callsTo("GET", "/v1/admin/dashboard")[0].query).toEqual({ days: "30" });
    expect(screen.getByText("₹1,500.00")).toBeTruthy();
    expect(screen.getByText("12 paid purchases")).toBeTruthy();
    // revenue delta compares the largest currency (INR 1500 vs 1000)
    expect(screen.getByText("+50%")).toBeTruthy();
    expect(screen.getByTitle("INR vs previous 30 days")).toBeTruthy();
    expect(screen.getByText("-10%")).toBeTruthy(); // paying users 9 vs 10
    expect(screen.getByText("+100%")).toBeTruthy(); // active users 800 vs 400
    expect(screen.getByText("coins: 250 · ad: 50")).toBeTruthy();
    expect(screen.getByText("12.3K")).toBeTruthy();
    expect(screen.getByText("2M")).toBeTruthy();
    expect(screen.getByText("400 episodes")).toBeTruthy();
    expect(screen.getByText("5,000 total")).toBeTruthy();
    const link = screen.getByRole("link", { name: "The Heiress" });
    expect(link.getAttribute("href")).toBe("/dramas/s1");
    const row = link.closest("tr")!;
    expect(within(row).getByText("12,000")).toBeTruthy();
    expect(within(row).getByText("345")).toBeTruthy();
    expect(screen.getByText("Top series (30 days)")).toBeTruthy();
    // the area charts mounted (ResponsiveContainer measured the stubbed ResizeObserver)
    const wrappers = await findCharts(container, 2);
    expect(wrappers[0].querySelector(".recharts-xAxis")?.textContent).toBe("10-0110-02"); // dates are shortened to MM-DD
    // tooltips carry the series' own numbers: counts for registrations, two decimals for revenue
    expect(hoverChart(wrappers[0], 700)).toContain("registrations : 7");
    expect(hoverChart(wrappers[1], 700)).toContain("revenue : 25.00");
  });

  it("refetches for the chosen range", async () => {
    mockApi.get("/v1/admin/dashboard", (c) => overview({ range_days: Number(c.query.days) }));
    renderPage(<DashboardPage />);
    await screen.findByText("Top series (30 days)");
    await ue.selectOptions(screen.getByLabelText("Overview range"), "90");
    expect(await screen.findByText("Top series (90 days)")).toBeTruthy();
    expect(mockApi.callsTo("GET", "/v1/admin/dashboard").at(-1)!.query).toEqual({ days: "90" });
  });

  it("copes with no revenue, no previous window, no unlocks and no data", async () => {
    mockApi.get(
      "/v1/admin/dashboard",
      overview({ revenue: {}, previous: null, unlocks_by_method: {}, daily: [], top_series: [] }),
    );
    renderPage(<DashboardPage />);
    expect(await screen.findByText("No published series yet")).toBeTruthy();
    expect(screen.getByText("none by method")).toBeTruthy();
    expect(screen.getAllByText("No data in range")).toHaveLength(2);
    expect(screen.queryByText(/^[+-]\d+%$/)).toBeNull();
  });

  it("does not compare a currency that had no revenue in the previous window", async () => {
    mockApi.get("/v1/admin/dashboard", overview({ revenue: { EUR: 10 }, previous: { revenue: {} } }));
    renderPage(<DashboardPage />);
    await screen.findByText("The Heiress");
    expect(screen.queryByTitle("EUR vs previous 30 days")).toBeNull();
  });

  it("shows an error with retry, then an inline error over stale data", async () => {
    mockApi.get("/v1/admin/dashboard", fail(500, "dash down"));
    renderPage(<DashboardPage />);
    expect(await screen.findByText("dash down")).toBeTruthy();
    mockApi.get("/v1/admin/dashboard", overview());
    await ue.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("The Heiress");
    mockApi.get("/v1/admin/dashboard", fail(500, "now stale"));
    await ue.selectOptions(screen.getByLabelText("Overview range"), "7");
    expect(await screen.findByText("now stale")).toBeTruthy();
    expect(screen.getByText("The Heiress")).toBeTruthy();
    mockApi.get("/v1/admin/dashboard", overview());
    await ue.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByText("now stale")).toBeNull());
  });
});

describe("DashboardPage tabs", () => {
  it("switches between Overview, Quality and Funnel, each loading its own data", async () => {
    mockApi.get("/v1/admin/dashboard", overview());
    mockApi.get("/v1/admin/analytics/qoe", []);
    mockApi.get("/v1/admin/analytics/funnel", { range_days: 30, steps: [] });
    renderPage(<DashboardPage />);
    const tabs = screen.getByRole("tablist", { name: "Dashboard sections" });
    expect(within(tabs).getByRole("tab", { name: "Overview" }).getAttribute("aria-selected")).toBe("true");
    await screen.findByText("The Heiress");
    expect(mockApi.callsTo("GET", "/v1/admin/analytics/qoe")).toHaveLength(0);

    await ue.click(within(tabs).getByRole("tab", { name: "Quality" }));
    expect(await screen.findByText("No playback events yet")).toBeTruthy();
    expect(screen.queryByText("The Heiress")).toBeNull();
    expect(within(tabs).getByRole("tab", { name: "Quality" }).getAttribute("aria-selected")).toBe("true");

    await ue.click(within(tabs).getByRole("tab", { name: "Funnel" }));
    expect(await screen.findByText("No funnel data")).toBeTruthy();
    expect(mockApi.callsTo("GET", "/v1/admin/analytics/funnel")).toHaveLength(1);

    await ue.click(within(tabs).getByRole("tab", { name: "Overview" }));
    expect(await screen.findByText("The Heiress")).toBeTruthy();
  });
});
