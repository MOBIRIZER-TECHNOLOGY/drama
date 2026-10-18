import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";
import { aUser, setAuth } from "@/test-utils/auth-context";
import { makeSeries } from "@/test-utils/fixtures";

vi.mock("@/lib/auth-context", () => import("@/test-utils/auth-context"));
const GET = vi.fn();
vi.mock("@/lib/client-api", () => ({ clientApi: { GET: (...a: unknown[]) => GET(...a) } }));

import { PersonalRails } from "./PersonalRails";

const ok = (data: unknown) => ({ data, response: { ok: true, status: 200 } });
const rail = (key: string, title: string, n: number) => ({ key, title, items: Array.from({ length: n }, (_, i) => makeSeries({ id: `${key}${i}`, slug: `${key}${i}`, title: `${key} ${i}` })) });

beforeEach(() => {
  GET.mockReset();
  setAuth({ status: "authenticated", user: aUser });
});

describe("PersonalRails", () => {
  it("renders nothing for guests and never fetches", () => {
    setAuth({ status: "anonymous" });
    const { container } = render(<PersonalRails />, { wrapper: appWrapper() });
    expect(container.innerHTML).toBe("");
    expect(GET).not.toHaveBeenCalled();
  });

  it("shows a skeleton while loading", () => {
    GET.mockReturnValue(new Promise(() => {}));
    const { container } = render(<PersonalRails />, { wrapper: appWrapper() });
    expect(container.querySelectorAll(".k-skeleton").length).toBeGreaterThan(6);
  });

  it("renders only continue + for_you rails that have items, in that order, titled from the catalogue", async () => {
    GET.mockResolvedValue(ok({ rails: [rail("trending", "Trending", 2), rail("for_you", "Picked", 1), rail("continue", "Resume", 2), rail("empty", "x", 0)] }));
    render(<PersonalRails />, { wrapper: appWrapper({ lang: "hi", messages: { "home.for_you": "आपके लिए" } }) });
    await screen.findByText("Continue Watching".replace("Continue Watching", "Resume"));
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Resume", "आपके लिए"]);
    expect(GET).toHaveBeenCalledWith("/v1/home", { params: { query: { lang: "hi" } } });
    expect(screen.getByRole("link", { name: "continue 0" }).getAttribute("href")).toBe("/hi/series/continue0");
  });

  it("falls back to default titles when the rail has none; skips empty personal rails", async () => {
    GET.mockResolvedValue(ok({ rails: [rail("continue", "", 1), rail("for_you", "", 0)] }));
    render(<PersonalRails />, { wrapper: appWrapper() });
    await screen.findByText("Continue Watching");
    expect(screen.queryByText("For You")).toBeNull();
  });

  it("hides the rails when the fetch fails", async () => {
    GET.mockResolvedValue({ error: { detail: "x" }, response: { ok: false, status: 500 } });
    const { container } = render(<PersonalRails />, { wrapper: appWrapper() });
    await waitFor(() => expect(container.querySelector(".k-skeleton")).toBeNull());
    expect(container.querySelector("section")).toBeNull();
  });
});
