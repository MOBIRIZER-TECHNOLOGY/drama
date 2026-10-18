import "@/test/dramas-dom-matchers";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fail, mockApi } from "@/test/api";
import { nav } from "@/test/navigation";
import { renderPage } from "@/test/render";
import SeriesDetailPage from "./page";

const LANGS = [
  { code: "hi", name: "Hindi", is_active: true },
  { code: "en", name: "English", is_active: true },
  { code: "ta", name: "Tamil", is_active: true },
  { code: "te", name: "Telugu", is_active: false },
];

const series = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  slug: "ashes",
  cover_url: null,
  banner_url: null,
  original_language: "hi",
  free_episodes: 3,
  episode_price: null,
  is_featured: false,
  is_premium: false,
  status: "published",
  released_at: null,
  content_rating: null,
  sort_weight: 0,
  visible_languages: null,
  territories: null,
  window_starts_at: null,
  window_ends_at: null,
  moderation_flags: [],
  moderation_note: null,
  updated_at: "2030-01-01T00:00:00Z",
  translations: [
    { lang: "hi", title: "राख", synopsis: null, seo_title: null, meta_description: null, keywords: null },
    { lang: "ta", title: "சாம்பல்", synopsis: null, seo_title: null, meta_description: null, keywords: null },
  ],
  category_ids: [],
  tags: [],
  episode_count: 1,
  episodes: [
    { id: "e1", number: 1, title: "Pilot", thumbnail_url: null, video_asset_id: null, asset_status: null, duration_sec: null, embed_html: null, price_override: null, is_free_override: null, status: "draft", scheduled_at: null },
  ],
  ...over,
});

const fakeTime = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });

beforeEach(() => {
  nav.set({ params: { id: "s1" } });
  mockApi.get("/v1/admin/series/s1", series());
  mockApi.get("/v1/admin/languages", LANGS);
  mockApi.get("/v1/admin/categories", []);
});
afterEach(() => vi.useRealTimers());

describe("SeriesDetailPage", () => {
  it("loads the series by id and shows header, episodes and the form", async () => {
    renderPage(<SeriesDetailPage />);
    expect(screen.getByRole("heading", { name: "Series" })).toBeInTheDocument();
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "राख" })).toBeInTheDocument();
    expect(screen.getByText("/ashes")).toBeInTheDocument();
    expect(screen.getAllByText("published").length).toBeGreaterThan(0);
    expect(screen.getByText("Episodes (1)")).toBeInTheDocument();
    expect(screen.getByText("Pilot")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to dramas/ })).toHaveAttribute("href", "/dramas");
    expect(mockApi.callsTo("GET", "/v1/admin/series/s1")).toHaveLength(1);
  });

  it("shows a retryable error when the series cannot be loaded", async () => {
    mockApi.get("/v1/admin/series/s1", fail(404, "Series not found"));
    renderPage(<SeriesDetailPage />);
    expect(await screen.findByText("Series not found")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Translate with AI" })).toBeNull();
    mockApi.get("/v1/admin/series/s1", series());
    await userEvent.click(screen.getByRole("button", { name: /Retry|Try again/i }));
    expect(await screen.findByRole("heading", { name: "राख" })).toBeInTheDocument();
  });

  it("keeps the page and shows an inline error when a refetch fails", async () => {
    renderPage(<SeriesDetailPage />);
    await screen.findByRole("heading", { name: "राख" });
    mockApi.get("/v1/admin/series/s1", fail(500, "blip"));
    mockApi.delete("/v1/admin/episodes/e1", undefined);
    await userEvent.click(screen.getByRole("button", { name: "Delete episode 1" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Delete episode" })).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("blip")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "राख" })).toBeInTheDocument();
  });

  it("refetches after an episode change", async () => {
    renderPage(<SeriesDetailPage />);
    await screen.findByRole("heading", { name: "राख" });
    mockApi.delete("/v1/admin/episodes/e1", undefined);
    mockApi.get("/v1/admin/series/s1", series({ episodes: [] }));
    await userEvent.click(screen.getByRole("button", { name: "Delete episode 1" }));
    await userEvent.click(within(screen.getByRole("dialog", { name: "Delete episode" })).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("No episodes yet")).toBeInTheDocument();
  });

  it("updates the header after the form saves", async () => {
    mockApi.put("/v1/admin/series/s1", () =>
      series({ status: "archived", translations: [{ lang: "hi", title: "नई राख", synopsis: null, seo_title: null, meta_description: null, keywords: null }], updated_at: "2030-01-02T00:00:00Z" }),
    );
    renderPage(<SeriesDetailPage />);
    await screen.findByRole("heading", { name: "राख" });
    await userEvent.selectOptions(screen.getByLabelText("Status"), "archived");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("heading", { name: "नई राख" })).toBeInTheDocument();
    expect(screen.getAllByText("archived").length).toBeGreaterThan(0);
  });

  describe("concurrent edits", () => {
    async function dirtyThenServerChange() {
      renderPage(<SeriesDetailPage />);
      await screen.findByRole("heading", { name: "राख" });
      await userEvent.type(screen.getByLabelText("Synopsis"), "my edit");
      mockApi.get("/v1/admin/series/s1", series({ updated_at: "2030-01-05T00:00:00Z", episodes: [], slug: "changed-on-server" }));
      mockApi.delete("/v1/admin/episodes/e1", undefined);
      await userEvent.click(screen.getByRole("button", { name: "Delete episode 1" }));
      await userEvent.click(within(screen.getByRole("dialog", { name: "Delete episode" })).getByRole("button", { name: "Delete" }));
    }

    it("freezes the form and offers a reload banner when the server copy changes under unsaved edits", async () => {
      await dirtyThenServerChange();
      expect(await screen.findByText(/This series changed on the server while you were editing/)).toBeInTheDocument();
      // the in-progress edit survives, and the new server slug has not replaced the form's
      expect((screen.getByLabelText("Synopsis") as HTMLTextAreaElement).value).toBe("my edit");
      expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("ashes");
      expect(await screen.findByText("No episodes yet")).toBeInTheDocument();
    });

    it("Reload form discards edits and shows the latest copy", async () => {
      await dirtyThenServerChange();
      await userEvent.click(await screen.findByRole("button", { name: "Reload form" }));
      await waitFor(() => expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("changed-on-server"));
      expect((screen.getByLabelText("Synopsis") as HTMLTextAreaElement).value).toBe("");
      expect(screen.queryByText(/changed on the server/)).toBeNull();
    });

    it("re-seeds the form silently when there are no unsaved edits", async () => {
      renderPage(<SeriesDetailPage />);
      await screen.findByRole("heading", { name: "राख" });
      mockApi.get("/v1/admin/series/s1", series({ updated_at: "2030-01-05T00:00:00Z", episodes: [], slug: "fresh" }));
      mockApi.delete("/v1/admin/episodes/e1", undefined);
      await userEvent.click(screen.getByRole("button", { name: "Delete episode 1" }));
      await userEvent.click(within(screen.getByRole("dialog", { name: "Delete episode" })).getByRole("button", { name: "Delete" }));
      await waitFor(() => expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("fresh"));
      expect(screen.queryByText(/changed on the server/)).toBeNull();
    });
  });

  describe("translate with AI", () => {
    const open = async () => {
      renderPage(<SeriesDetailPage />);
      await screen.findByRole("heading", { name: "राख" });
      await userEvent.click(screen.getByRole("button", { name: /Translate with AI/ }));
      return within(screen.getByRole("dialog", { name: "Translate with AI" }));
    };

    it("lists active non-original languages, selecting all by default, and queues all as null", async () => {
      mockApi.post("/v1/admin/ai/series/s1/translate", { queued: true, job_id: "j1" });
      mockApi.get("/v1/admin/ai/jobs/j1", { job_id: "j1", status: "running" });
      const dlg = await open();
      expect(await dlg.findByText("English")).toBeInTheDocument();
      expect(dlg.getByText("Tamil")).toBeInTheDocument();
      expect(dlg.queryByText("Telugu")).toBeNull(); // inactive
      expect(dlg.queryByText("Hindi")).toBeNull(); // original
      expect(dlg.getByText("has translation")).toBeInTheDocument(); // Tamil exists
      expect(dlg.getByLabelText("All active languages")).toBeChecked();
      await userEvent.click(dlg.getByRole("button", { name: "Queue translation (2)" }));
      expect(await screen.findByText("Translation queued (job j1)")).toBeInTheDocument();
      expect(mockApi.callsTo("POST", "/v1/admin/ai/series/s1/translate")[0].body).toEqual({ languages: null });
      expect(screen.queryByRole("dialog", { name: "Translate with AI" })).toBeNull();
    });

    it("sends a specific subset and refetches once the job completes", async () => {
      fakeTime();
      mockApi.post("/v1/admin/ai/series/s1/translate", { queued: true, job_id: "j1" });
      mockApi.get("/v1/admin/ai/jobs/j1", { job_id: "j1", status: "complete" });
      renderPage(<SeriesDetailPage />);
      const u = userEvent.setup({ delay: null });
      await screen.findByRole("heading", { name: "राख" });
      await u.click(screen.getByRole("button", { name: /Translate with AI/ }));
      const dlg = within(screen.getByRole("dialog", { name: "Translate with AI" }));
      await dlg.findByText("English");
      await u.click(dlg.getByLabelText(/Tamil/));
      expect(dlg.getByLabelText("All active languages")).not.toBeChecked();
      await u.click(dlg.getByRole("button", { name: "Queue translation (1)" }));
      await screen.findByText("Translation queued (job j1)");
      expect(mockApi.callsTo("POST", "/v1/admin/ai/series/s1/translate")[0].body).toEqual({ languages: ["en"] });
      mockApi.get("/v1/admin/series/s1", series({ updated_at: "2030-02-01T00:00:00Z", slug: "translated" }));
      await vi.waitFor(() => expect(screen.getByText("Translation finished.")).toBeInTheDocument());
      await vi.waitFor(() => expect(mockApi.callsTo("GET", "/v1/admin/series/s1")).toHaveLength(2));
    });

    it("the all-languages checkbox clears and restores the selection", async () => {
      const dlg = await open();
      await dlg.findByText("English");
      await userEvent.click(dlg.getByLabelText("All active languages"));
      expect(dlg.getByRole("button", { name: "Queue translation (0)" })).toBeDisabled();
      await userEvent.click(dlg.getByLabelText(/English/));
      await userEvent.click(dlg.getByLabelText(/English/));
      await userEvent.click(dlg.getByLabelText("All active languages"));
      expect(dlg.getByRole("button", { name: "Queue translation (2)" })).not.toBeDisabled();
    });

    it("reports a failed translation job as an error", async () => {
      mockApi.post("/v1/admin/ai/series/s1/translate", { queued: true, job_id: "j1" });
      mockApi.get("/v1/admin/ai/jobs/j1", { job_id: "j1", status: "failed", error: "quota" });
      const dlg = await open();
      await dlg.findByText("English");
      await userEvent.click(dlg.getByRole("button", { name: /Queue translation/ }));
      expect(await screen.findByText("Translation failed: quota.", {}, { timeout: 5000 })).toBeInTheDocument();
    }, 10000);

    it("says when nothing was queued and does not poll", async () => {
      mockApi.post("/v1/admin/ai/series/s1/translate", { queued: false });
      const dlg = await open();
      await dlg.findByText("English");
      await userEvent.click(dlg.getByRole("button", { name: /Queue translation/ }));
      expect(await screen.findByText("Translation: nothing to do")).toBeInTheDocument();
      expect(mockApi.callsTo("GET", "/v1/admin/ai/jobs/*")).toHaveLength(0);
    });

    it("keeps the dialog open and explains an AI outage", async () => {
      mockApi.post("/v1/admin/ai/series/s1/translate", fail(503, "down"));
      const dlg = await open();
      await dlg.findByText("English");
      await userEvent.click(dlg.getByRole("button", { name: /Queue translation/ }));
      expect(await screen.findByText(/AI is unavailable right now/)).toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "Translate with AI" })).toBeInTheDocument();
    });

    it("explains when there are no other active languages", async () => {
      mockApi.get("/v1/admin/languages", [LANGS[0]]);
      const dlg = await open();
      expect(await dlg.findByText(/No other active languages/)).toBeInTheDocument();
      expect(dlg.getByRole("button", { name: /Queue translation/ })).toBeDisabled();
    });

    it("shows a language-list failure and a loading state", async () => {
      mockApi.get("/v1/admin/languages", () => fail(500, "lang down"));
      const dlg = await open();
      expect(await dlg.findByText("lang down")).toBeInTheDocument();
    });

    it("can be cancelled", async () => {
      const dlg = await open();
      await dlg.findByText("English");
      await userEvent.click(dlg.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("dialog", { name: "Translate with AI" })).toBeNull();
      expect(mockApi.callsTo("POST", "/v1/admin/ai/series/s1/translate")).toHaveLength(0);
    });
  });

  describe("refresh embeddings", () => {
    it("queues the job and reports its completion", async () => {
      fakeTime();
      mockApi.post("/v1/admin/ai/series/s1/embeddings", { queued: true, job_id: "j2" });
      mockApi.get("/v1/admin/ai/jobs/j2", { job_id: "j2", status: "complete" });
      renderPage(<SeriesDetailPage />);
      const u = userEvent.setup({ delay: null });
      await screen.findByRole("heading", { name: "राख" });
      await u.click(screen.getByRole("button", { name: /Refresh embeddings/ }));
      expect(await screen.findByText("Embedding refresh queued (job j2)")).toBeInTheDocument();
      await vi.waitFor(() => expect(screen.getByText("Embedding refresh finished.")).toBeInTheDocument());
      // completion of an embeddings job does not refetch the series
      expect(mockApi.callsTo("GET", "/v1/admin/series/s1")).toHaveLength(1);
    });

    it("explains an AI failure", async () => {
      mockApi.post("/v1/admin/ai/series/s1/embeddings", fail(502, "bad gateway"));
      renderPage(<SeriesDetailPage />);
      await screen.findByRole("heading", { name: "राख" });
      await userEvent.click(screen.getByRole("button", { name: /Refresh embeddings/ }));
      expect(await screen.findByText(/The AI provider returned an error: bad gateway/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Refresh embeddings/ })).not.toBeDisabled();
    });

    it("does not poll when nothing was queued", async () => {
      mockApi.post("/v1/admin/ai/series/s1/embeddings", { queued: false });
      renderPage(<SeriesDetailPage />);
      await screen.findByRole("heading", { name: "राख" });
      await userEvent.click(screen.getByRole("button", { name: /Refresh embeddings/ }));
      expect(await screen.findByText("Embedding refresh: nothing to do")).toBeInTheDocument();
      expect(mockApi.callsTo("GET", "/v1/admin/ai/jobs/*")).toHaveLength(0);
    });

    it("stops polling jobs when the page unmounts", async () => {
      fakeTime();
      mockApi.post("/v1/admin/ai/series/s1/embeddings", { queued: true, job_id: "j2" });
      mockApi.get("/v1/admin/ai/jobs/j2", { job_id: "j2", status: "running" });
      const view = renderPage(<SeriesDetailPage />);
      const u = userEvent.setup({ delay: null });
      await screen.findByRole("heading", { name: "राख" });
      await u.click(screen.getByRole("button", { name: /Refresh embeddings/ }));
      await screen.findByText(/queued/);
      await vi.waitFor(() => expect(mockApi.callsTo("GET", "/v1/admin/ai/jobs/j2")).toHaveLength(1));
      view.unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20000);
      });
      expect(mockApi.callsTo("GET", "/v1/admin/ai/jobs/j2")).toHaveLength(1);
    });
  });
});
