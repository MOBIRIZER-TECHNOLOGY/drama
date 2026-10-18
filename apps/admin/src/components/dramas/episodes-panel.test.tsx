import "@/test/dramas-dom-matchers";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { retryVideo, uploadImage, uploadVideo } from "@/lib/uploads";
import { fail, mockApi } from "@/test/api";
import { renderPage } from "@/test/render";
import { EpisodesPanel } from "./episodes-panel";

vi.mock("@/lib/uploads", async (orig) => ({
  ...(await orig<typeof import("@/lib/uploads")>()),
  uploadVideo: vi.fn(),
  uploadImage: vi.fn(),
  retryVideo: vi.fn(async (assetId: string) => (await orig<typeof import("@/lib/uploads")>()).retryVideo(assetId)),
}));
const upVideo = vi.mocked(uploadVideo);
const upImage = vi.mocked(uploadImage);
const retryMock = vi.mocked(retryVideo);

type Ep = Record<string, unknown>;
const ep = (number: number, over: Ep = {}): Ep => ({
  id: `e${number}`,
  number,
  title: `Title ${number}`,
  thumbnail_url: null,
  video_asset_id: null,
  asset_status: null,
  duration_sec: null,
  embed_html: null,
  price_override: null,
  is_free_override: null,
  status: "draft",
  scheduled_at: null,
  ...over,
});

function setup(episodes: Ep[] = [], onChanged = vi.fn()) {
  renderPage(<EpisodesPanel seriesId="s1" episodes={episodes as never} onChanged={onChanged} />);
  return { onChanged };
}
const dialog = (name: RegExp | string) => within(screen.getByRole("dialog", { name }));
const row = (n: number) => screen.getAllByRole("row").find((r) => r.querySelector("td")?.textContent === String(n)) as HTMLElement;
const user = () => userEvent.setup({ delay: null });

beforeEach(() => {
  upVideo.mockResolvedValue({ id: "a-new", status: "queued" } as never);
});
afterEach(() => vi.useRealTimers());

describe("EpisodesPanel table", () => {
  it("shows the empty state and the next number for a new episode", async () => {
    setup();
    expect(screen.getByText("Episodes (0)")).toBeInTheDocument();
    expect(screen.getByText("No episodes yet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Add episode/ }));
    expect((dialog("Add episode").getByLabelText(/^Number/) as HTMLInputElement).value).toBe("1");
  });

  it("renders rows sorted by number with video, pricing and schedule details", () => {
    setup([
      ep(3, { video_asset_id: "a3", asset_status: "failed", duration_sec: 65 }),
      ep(1, { video_asset_id: "a1", asset_status: "ready", duration_sec: 125, is_free_override: true, price_override: 7, thumbnail_url: "https://cdn.test/t.jpg" }),
      ep(2, { embed_html: "<iframe/>", is_free_override: false, status: "review", scheduled_at: "2030-01-01T00:00:00Z" }),
      ep(4, { title: null }),
      ep(5, { video_asset_id: "a5" }),
    ]);
    const nums = screen.getAllByRole("row").slice(1).map((r) => r.querySelector("td")?.textContent);
    expect(nums).toEqual(["1", "2", "3", "4", "5"]);
    expect(within(row(1)).getByText("2:05")).toBeInTheDocument();
    expect(within(row(1)).getByText("free")).toBeInTheDocument();
    expect(within(row(1)).getByText("7 coins")).toBeInTheDocument();
    expect(row(1).querySelector("img")?.getAttribute("src")).toBe("https://cdn.test/t.jpg");
    expect(within(row(2)).getByText("embed")).toBeInTheDocument();
    expect(within(row(2)).getByText("paid")).toBeInTheDocument();
    expect(within(row(2)).getByText("scheduled")).toBeInTheDocument();
    expect(within(row(3)).getByText("1:05")).toBeInTheDocument();
    expect(within(row(3)).getByRole("button", { name: /Retry/ })).toBeInTheDocument();
    expect(screen.getByText("Untitled")).toBeInTheDocument();
    expect(screen.getByText("no video")).toBeInTheDocument();
    expect(screen.getAllByText("inherit").length).toBeGreaterThan(0);
    expect(within(row(5)).getByText("queued")).toBeInTheDocument(); // asset without status
    expect(row(1).querySelector("img")).not.toBeNull();
    expect(row(4).querySelector("img")).toBeNull();
    // subtitles only for ready assets
    expect(within(row(1)).getByRole("button", { name: "Subtitles" })).not.toBeDisabled();
    expect(within(row(3)).getByRole("button", { name: "Subtitles" })).toBeDisabled();
  });

  it("a non-review episode with a scheduled_at is not shown as scheduled", () => {
    setup([ep(1, { status: "published", scheduled_at: "2030-01-01T00:00:00Z" })]);
    expect(screen.queryByText("scheduled")).toBeNull();
  });

  it("deletes after confirmation", async () => {
    mockApi.delete("/v1/admin/episodes/e2", undefined);
    const { onChanged } = setup([ep(1), ep(2)]);
    await userEvent.click(screen.getByRole("button", { name: "Delete episode 2" }));
    expect(dialog("Delete episode").getByText(/Delete episode 2 “Title 2”\?/)).toBeInTheDocument();
    await userEvent.click(dialog("Delete episode").getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Episode 2 deleted")).toBeInTheDocument();
    expect(mockApi.callsTo("DELETE", "/v1/admin/episodes/e2")).toHaveLength(1);
    expect(onChanged).toHaveBeenCalled();
  });

  it("keeps the dialog's message free of a title when untitled, and reports a delete failure", async () => {
    mockApi.delete("/v1/admin/episodes/e1", fail(500, "boom"));
    const { onChanged } = setup([ep(1, { title: null })]);
    await userEvent.click(screen.getByRole("button", { name: "Delete episode 1" }));
    expect(dialog("Delete episode").getByText(/^Delete episode 1\?/)).toBeInTheDocument();
    await userEvent.click(dialog("Delete episode").getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("boom")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("cancelling the delete confirmation sends nothing", async () => {
    setup([ep(1)]);
    await userEvent.click(screen.getByRole("button", { name: "Delete episode 1" }));
    await userEvent.click(dialog("Delete episode").getByRole("button", { name: "Cancel" }));
    expect(mockApi.calls).toHaveLength(0);
  });

  it("retries a failed transcode", async () => {
    mockApi.post("/v1/admin/uploads/videos/a3/retry", { id: "a3", status: "queued" });
    const { onChanged } = setup([ep(3, { video_asset_id: "a3", asset_status: "failed" })]);
    await userEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(await screen.findByText("Transcode re-queued")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it("reports a failed retry", async () => {
    mockApi.post("/v1/admin/uploads/videos/a3/retry", fail(500, "nope"));
    const { onChanged } = setup([ep(3, { video_asset_id: "a3", asset_status: "failed" })]);
    await userEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(await screen.findByText("nope")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("falls back to a generic message when the retry rejects with a non-Error", async () => {
    retryMock.mockRejectedValueOnce("weird");
    setup([ep(3, { video_asset_id: "a3", asset_status: "failed" })]);
    await userEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(await screen.findByText("Retry failed")).toBeInTheDocument();
  });

  it("labels a kept asset with no known status generically", async () => {
    setup([ep(1, { video_asset_id: "a1", asset_status: null })]);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("dialog", { name: "Edit episode 1" })).toHaveTextContent("Keep current (asset)");
  });

  it("opens the add-N and ingest dialogs", async () => {
    setup([ep(1)]);
    await userEvent.click(screen.getByRole("button", { name: "Add N episodes" }));
    expect(screen.getByRole("dialog", { name: "Add numbered episodes" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Ingest season/ }));
    expect(screen.getByRole("dialog", { name: "Ingest a season" })).toBeInTheDocument();
    await userEvent.click(dialog("Ingest a season").getAllByRole("button", { name: "Close" })[0]);
    expect(screen.queryByRole("dialog", { name: "Ingest a season" })).toBeNull();
  });
});

describe("subtitles", () => {
  const ready = () => [ep(1, { video_asset_id: "a1", asset_status: "ready" })];

  it("queues, polls the job, and reports completion", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    mockApi.post("/v1/admin/ai/episodes/e1/subtitles", { queued: true, job_id: "j1" });
    mockApi.get("/v1/admin/ai/jobs/j1", { job_id: "j1", status: "complete" });
    setup(ready());
    await user().click(screen.getByRole("button", { name: "Subtitles" }));
    expect(await screen.findByText("Subtitles for episode 1 queued (job j1)")).toBeInTheDocument();
    expect(mockApi.callsTo("POST", "/v1/admin/ai/episodes/e1/subtitles")[0].body).toEqual({ languages: null });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(await screen.findByText("Subtitles for episode 1 finished.")).toBeInTheDocument();
  });

  it("reports a failed job as an error", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    mockApi.post("/v1/admin/ai/episodes/e1/subtitles", { queued: true, job_id: "j1" });
    mockApi.get("/v1/admin/ai/jobs/j1", { job_id: "j1", status: "failed", error: "no audio" });
    setup(ready());
    await user().click(screen.getByRole("button", { name: "Subtitles" }));
    await screen.findByText(/queued/);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(await screen.findByText("Subtitles for episode 1 failed: no audio.")).toBeInTheDocument();
  });

  it("does not poll when nothing was queued", async () => {
    mockApi.post("/v1/admin/ai/episodes/e1/subtitles", { queued: false });
    setup(ready());
    await userEvent.click(screen.getByRole("button", { name: "Subtitles" }));
    expect(await screen.findByText("Subtitles for episode 1: nothing to do")).toBeInTheDocument();
    expect(mockApi.callsTo("GET")).toHaveLength(0);
  });

  it("maps an AI outage to a readable error", async () => {
    mockApi.post("/v1/admin/ai/episodes/e1/subtitles", fail(503, "down"));
    setup(ready());
    await userEvent.click(screen.getByRole("button", { name: "Subtitles" }));
    expect(await screen.findByText(/AI is unavailable right now/)).toBeInTheDocument();
  });

  it("stops polling a job when the panel unmounts", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    mockApi.post("/v1/admin/ai/episodes/e1/subtitles", { queued: true, job_id: "j1" });
    mockApi.get("/v1/admin/ai/jobs/j1", { job_id: "j1", status: "running" });
    const view = renderPage(<EpisodesPanel seriesId="s1" episodes={ready() as never} onChanged={() => {}} />);
    await user().click(screen.getByRole("button", { name: "Subtitles" }));
    await screen.findByText(/queued/);
    await vi.waitFor(() => expect(mockApi.callsTo("GET", "/v1/admin/ai/jobs/j1")).toHaveLength(1));
    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(mockApi.callsTo("GET", "/v1/admin/ai/jobs/j1")).toHaveLength(1);
  });
});

describe("asset polling", () => {
  it("refreshes the list once a transcoding asset finishes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    mockApi.get("/v1/admin/uploads/videos/a1", { id: "a1", status: "ready" });
    const { onChanged } = setup([ep(1, { video_asset_id: "a1", asset_status: "transcoding" }), ep(2, { video_asset_id: "a2", asset_status: "ready" })]);
    expect(onChanged).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(mockApi.callsTo("GET", "/v1/admin/uploads/videos/*").map((c) => c.path)).toEqual(["/v1/admin/uploads/videos/a1"]);
  });

  it("pauses panel polling while an episode dialog is open", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    mockApi.get("/v1/admin/uploads/videos/a1", { id: "a1", status: "transcoding" });
    setup([ep(1, { video_asset_id: "a1", asset_status: "transcoding" })]);
    await user().click(within(row(1)).getByRole("button", { name: "Edit" }));
    mockApi.calls.length = 0;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    // the dialog itself watches its "keep" asset: exactly one poller, not two
    await vi.waitFor(() => expect(mockApi.callsTo("GET", "/v1/admin/uploads/videos/a1")).toHaveLength(1));
    await vi.waitFor(() => expect(dialog("Edit episode 1").getByText(/Keep current \(transcoding\)/)).toBeInTheDocument());
  });
});

describe("EpisodeDialog", () => {
  async function openNew(episodes: Ep[] = []) {
    const s = setup(episodes);
    await userEvent.click(screen.getByRole("button", { name: /Add episode/ }));
    return s;
  }
  const d = () => dialog(/Add episode|Edit episode/);
  const save = (label = "Add") => userEvent.click(d().getByRole("button", { name: label }));

  it("closes without saving on Cancel", async () => {
    await openNew();
    await userEvent.click(d().getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Add episode" })).toBeNull();
    expect(mockApi.calls).toHaveLength(0);
  });

  it("defaults the number to last + 1 and creates an episode with the entered fields", async () => {
    mockApi.post("/v1/admin/series/s1/episodes", { id: "new" });
    const { onChanged } = await openNew([ep(4)]);
    expect((d().getByLabelText(/^Number/) as HTMLInputElement).value).toBe("5");
    await userEvent.type(d().getByLabelText("Title"), "  Pilot ");
    await userEvent.type(d().getByLabelText("Price override (coins)"), "12");
    await userEvent.selectOptions(d().getByLabelText("Free override"), "paid");
    await userEvent.selectOptions(d().getByLabelText("Status"), "review");
    fireEvent.change(d().getByLabelText("Scheduled for"), { target: { value: "2030-05-06T07:08" } });
    await save();
    expect(await screen.findByText("Episode added")).toBeInTheDocument();
    expect(mockApi.callsTo("POST", "/v1/admin/series/s1/episodes")[0].body).toEqual({
      number: 5,
      title: "Pilot",
      thumbnail_url: null,
      video_asset_id: null,
      embed_html: null,
      price_override: 12,
      is_free_override: false,
      status: "review",
      scheduled_at: new Date("2030-05-06T07:08").toISOString(),
    });
    expect(onChanged).toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Add episode" })).toBeNull();
  });

  it("validates number, price and schedule/status and focuses the first invalid field", async () => {
    await openNew();
    const num = d().getByLabelText(/^Number/);
    await userEvent.clear(num);
    await userEvent.type(d().getByLabelText("Price override (coins)"), "1.5");
    await userEvent.selectOptions(d().getByLabelText("Status"), "published");
    fireEvent.change(d().getByLabelText("Scheduled for"), { target: { value: "2030-05-06T07:08" } });
    await save();
    expect(d().getByText("Episode number must be 1 or more.")).toBeInTheDocument();
    expect(d().getByText("Must be a whole number of coins (or blank).")).toBeInTheDocument();
    expect(d().getByText(/A published episode is already live/)).toBeInTheDocument();
    expect(num).toHaveFocus();
    expect(mockApi.callsTo("POST")).toHaveLength(0);
    // editing a field clears just its error
    await userEvent.type(num, "2");
    expect(d().queryByText("Episode number must be 1 or more.")).toBeNull();
    await userEvent.selectOptions(d().getByLabelText("Status"), "review");
    expect(d().queryByText(/A published episode is already live/)).toBeNull();
    await userEvent.clear(d().getByLabelText("Price override (coins)"));
    await userEvent.type(d().getByLabelText("Price override (coins)"), "-3");
    await save();
    expect(d().getByText("Must be a whole number of coins (or blank).")).toBeInTheDocument();
  });

  it("warns that a schedule only applies while in review", async () => {
    await openNew();
    fireEvent.change(d().getByLabelText("Scheduled for"), { target: { value: "2030-05-06T07:08" } });
    expect(d().getByText(/only takes effect while the status is/)).toBeInTheDocument();
    await userEvent.selectOptions(d().getByLabelText("Status"), "review");
    expect(d().queryByText(/only takes effect while the status is/)).toBeNull();
  });

  it("validates and submits an embed", async () => {
    mockApi.post("/v1/admin/series/s1/episodes", { id: "new" });
    await openNew();
    await userEvent.click(d().getByLabelText("Embed HTML", { selector: "input" }));
    const box = d().getByRole("textbox", { name: /Embed HTML/ });
    await save();
    expect(d().getByText("Paste an <iframe> embed.")).toBeInTheDocument();
    await userEvent.type(box, "<div>x</div>");
    expect(d().queryByText("Paste an <iframe> embed.")).toBeNull();
    await save();
    expect(d().getByText("Only a single <iframe> element is allowed.")).toBeInTheDocument();
    await userEvent.clear(box);
    fireEvent.change(box, { target: { value: '  <iframe src="https://www.youtube.com/embed/abc"></iframe> ' } });
    await save();
    await screen.findByText("Episode added");
    expect(mockApi.callsTo("POST", "/v1/admin/series/s1/episodes")[0].body).toMatchObject({
      embed_html: '<iframe src="https://www.youtube.com/embed/abc"></iframe>',
      video_asset_id: null,
    });
  });

  it("routes a server-side embed rejection onto the embed field, other errors to a toast", async () => {
    const good = '<iframe src="https://www.youtube.com/embed/abc"></iframe>';
    await openNew();
    await userEvent.click(d().getByLabelText("Embed HTML", { selector: "input" }));
    fireEvent.change(d().getByRole("textbox", { name: /Embed HTML/ }), { target: { value: good } });
    mockApi.post("/v1/admin/series/s1/episodes", fail(422, "iframe host not allowed"));
    await save();
    expect(await d().findByText("iframe host not allowed")).toBeInTheDocument();
    mockApi.post("/v1/admin/series/s1/episodes", fail(500, "db down"));
    await save();
    expect(await screen.findByText("db down")).toBeInTheDocument();
    // a non-embed failure becomes a toast, not a field error (and the re-validation cleared the old one)
    expect(d().queryByText("iframe host not allowed")).toBeNull();
  });

  it("edits an existing episode, keeping its asset, and sends the PUT", async () => {
    mockApi.put("/v1/admin/episodes/e2", { id: "e2" });
    const { onChanged } = setup([
      ep(2, { video_asset_id: "a2", asset_status: "ready", is_free_override: true, price_override: 3, status: "review", scheduled_at: "2030-01-02T03:04:00Z", thumbnail_url: "https://cdn.test/t.jpg" }),
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(d().getByText(/Keep current \(ready\)/)).toBeInTheDocument();
    expect((d().getByLabelText("Free override") as HTMLSelectElement).value).toBe("free");
    expect((d().getByLabelText("Price override (coins)") as HTMLInputElement).value).toBe("3");
    expect((d().getByLabelText("Status") as HTMLSelectElement).value).toBe("review");
    await userEvent.clear(d().getByLabelText("Title"));
    await save("Save");
    expect(await screen.findByText("Episode saved")).toBeInTheDocument();
    expect(mockApi.callsTo("PUT", "/v1/admin/episodes/e2")[0].body).toMatchObject({
      number: 2,
      title: null,
      thumbnail_url: "https://cdn.test/t.jpg",
      video_asset_id: "a2",
      embed_html: null,
      price_override: 3,
      is_free_override: true,
      status: "review",
      scheduled_at: "2030-01-02T03:04:00.000Z",
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("opens an embed episode in embed mode and an inherit episode with defaults", async () => {
    setup([ep(1, { embed_html: '<iframe src="https://vimeo.com/x"></iframe>', is_free_override: false })]);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect((d().getByRole("textbox", { name: /Embed HTML/ }) as HTMLTextAreaElement).value).toContain("vimeo.com");
    expect(d().queryByText(/Keep current/)).toBeNull();
    expect((d().getByLabelText("Free override") as HTMLSelectElement).value).toBe("paid");
  });

  it("dropping the video (None) sends no asset", async () => {
    mockApi.put("/v1/admin/episodes/e1", { id: "e1" });
    setup([ep(1, { video_asset_id: "a1", asset_status: "ready" })]);
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(d().getByLabelText("None"));
    await save("Save");
    await screen.findByText("Episode saved");
    expect(mockApi.callsTo("PUT", "/v1/admin/episodes/e1")[0].body).toMatchObject({ video_asset_id: null, embed_html: null });
  });

  it("uploads a thumbnail through the image field and stores its key", async () => {
    upImage.mockResolvedValue({ key: "thumbs/x.jpg", url: "https://cdn.test/thumbs/x.jpg" });
    mockApi.post("/v1/admin/series/s1/episodes", { id: "new" });
    await openNew();
    const file = new File(["x"], "t.jpg", { type: "image/jpeg" });
    await userEvent.upload(d().getByLabelText("Thumbnail (9:16) file"), file);
    await screen.findByText("Thumbnail (9:16) uploaded");
    await save();
    await screen.findByText("Episode added");
    expect(mockApi.callsTo("POST", "/v1/admin/series/s1/episodes")[0].body).toMatchObject({ thumbnail_url: "thumbs/x.jpg" });
  });

  describe("video upload", () => {
    async function openUpload() {
      await openNew();
      await userEvent.click(d().getByLabelText("Upload file"));
    }
    const pick = () => userEvent.upload(d().getByLabelText("Video file"), new File(["v"], "v.mp4", { type: "video/mp4" }));

    it("the Choose video button opens the hidden file chooser", async () => {
      await openUpload();
      const click = vi.spyOn(d().getByLabelText("Video file"), "click");
      await userEvent.click(d().getByRole("button", { name: /Choose video/ }));
      expect(click).toHaveBeenCalled();
    });

    it("requires a file before saving", async () => {
      await openUpload();
      expect(d().getByText(/MP4\/MOV\/WebM up to 2 GB/)).toBeInTheDocument();
      await save();
      expect(d().getByText("Choose a video file first, or switch to another video source.")).toBeInTheDocument();
    });

    it("uploads, watches the transcode to ready, and saves with the asset id", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      let polls = 0;
      mockApi.get("/v1/admin/uploads/videos/a-new", () =>
        ++polls === 1 ? { id: "a-new", status: "transcoding" } : { id: "a-new", status: "ready", duration_sec: 90 },
      );
      mockApi.post("/v1/admin/series/s1/episodes", { id: "new" });
      setup();
      const u = user();
      await u.click(screen.getByRole("button", { name: /Add episode/ }));
      await u.click(d().getByLabelText("Upload file"));
      await u.upload(d().getByLabelText("Video file"), new File(["v"], "v.mp4", { type: "video/mp4" }));
      expect(await screen.findByText("Video uploaded; transcoding queued")).toBeInTheDocument();
      expect(await d().findByText("transcoding")).toBeInTheDocument();
      expect(d().getByText(/Transcoding runs in the background/)).toBeInTheDocument();
      expect(d().getByRole("button", { name: /Replace file/ })).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(await d().findByText("ready")).toBeInTheDocument();
      expect(d().getByText("1:30")).toBeInTheDocument();
      await u.click(d().getByRole("button", { name: "Add" }));
      await screen.findByText("Episode added");
      expect(mockApi.callsTo("POST", "/v1/admin/series/s1/episodes")[0].body).toMatchObject({ video_asset_id: "a-new" });
    });

    it("shows progress while uploading and lets the operator cancel", async () => {
      upVideo.mockImplementation((_f, onProgress, signal) => {
        onProgress?.(0.4);
        return new Promise((_res, rej) => signal?.addEventListener("abort", () => rej(new ApiError("Upload cancelled", 0, "upload_cancelled"))));
      });
      await openUpload();
      await pick();
      expect(await d().findByText("Uploading 40%")).toBeInTheDocument();
      expect(d().getByRole("button", { name: "Cancel" })).toBeDisabled();
      await userEvent.click(d().getByRole("button", { name: "Cancel upload" }));
      await waitFor(() => expect(d().queryByText(/Uploading/)).toBeNull());
      expect(screen.queryByText("Upload cancelled")).toBeNull();
    });

    it("toasts an upload failure", async () => {
      upVideo.mockRejectedValue(new ApiError("Video is empty.", 0, "file_empty"));
      await openUpload();
      await pick();
      expect(await screen.findByText("Video is empty.")).toBeInTheDocument();
    });

    it("retries a failed asset and starts watching the new state", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      upVideo.mockResolvedValue({ id: "a-new", status: "failed", error: "codec" } as never);
      mockApi.get("/v1/admin/uploads/videos/a-new", { id: "a-new", status: "failed", error: "codec" });
      mockApi.post("/v1/admin/uploads/videos/a-new/retry", () => {
        mockApi.get("/v1/admin/uploads/videos/a-new", { id: "a-new", status: "transcoding" });
        return { id: "a-new", status: "queued" };
      });
      setup();
      const u = user();
      await u.click(screen.getByRole("button", { name: /Add episode/ }));
      await u.click(d().getByLabelText("Upload file"));
      await u.upload(d().getByLabelText("Video file"), new File(["v"], "v.mp4", { type: "video/mp4" }));
      expect(await d().findByText("codec")).toBeInTheDocument();
      await u.click(d().getByRole("button", { name: /Retry/ }));
      expect(await d().findByText("transcoding")).toBeInTheDocument();
      expect(d().queryByText("codec")).toBeNull();
      expect(mockApi.callsTo("POST", "/v1/admin/uploads/videos/a-new/retry")).toHaveLength(1);
    });

    it("falls back to generic messages for non-Error rejections", async () => {
      upVideo.mockRejectedValueOnce("weird");
      await openUpload();
      await pick();
      expect(await screen.findByText("Upload failed")).toBeInTheDocument();
      upVideo.mockResolvedValueOnce({ id: "a-new", status: "failed" } as never);
      mockApi.get("/v1/admin/uploads/videos/a-new", { id: "a-new", status: "failed" });
      await pick();
      retryMock.mockRejectedValueOnce("weird");
      await userEvent.click(await d().findByRole("button", { name: /Retry/ }));
      expect(await screen.findByText("Retry failed")).toBeInTheDocument();
    });

    it("reports a retry failure", async () => {
      upVideo.mockResolvedValue({ id: "a-new", status: "failed" } as never);
      mockApi.post("/v1/admin/uploads/videos/a-new/retry", fail(500, "retry boom"));
      mockApi.get("/v1/admin/uploads/videos/a-new", { id: "a-new", status: "failed" });
      await openUpload();
      await pick();
      await userEvent.click(await d().findByRole("button", { name: /Retry/ }));
      expect(await screen.findByText("retry boom")).toBeInTheDocument();
    });

    it("surfaces polling errors as a status-check warning", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      mockApi.get("/v1/admin/uploads/videos/a-new", fail(500, "poll down"));
      setup();
      const u = user();
      await u.click(screen.getByRole("button", { name: /Add episode/ }));
      await u.click(d().getByLabelText("Upload file"));
      await u.upload(d().getByLabelText("Video file"), new File(["v"], "v.mp4", { type: "video/mp4" }));
      await screen.findByText("Video uploaded; transcoding queued");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(await d().findByText(/Status check: poll down/)).toBeInTheDocument();
    });

    it("ignores a cancelled file chooser", async () => {
      await openUpload();
      fireEvent.change(d().getByLabelText("Video file"), { target: { files: [] } });
      expect(upVideo).not.toHaveBeenCalled();
    });

    it("a second pick aborts the first upload", async () => {
      const signals: AbortSignal[] = [];
      upVideo.mockImplementation((_f, _p, signal) => {
        if (signal) signals.push(signal);
        return new Promise(() => {});
      });
      await openUpload();
      await pick();
      await pick();
      expect(signals).toHaveLength(2);
      expect(signals[0].aborted).toBe(true);
      expect(signals[1].aborted).toBe(false);
    });

    it("aborts an in-flight upload when the panel unmounts", async () => {
      let signal: AbortSignal | undefined;
      upVideo.mockImplementation((_f, _p, s) => {
        signal = s;
        return new Promise(() => {});
      });
      const view = renderPage(<EpisodesPanel seriesId="s1" episodes={[]} onChanged={() => {}} />);
      await userEvent.click(screen.getAllByRole("button", { name: /Add episode/ })[0]);
      await userEvent.click(d().getByLabelText("Upload file"));
      await pick();
      expect(signal?.aborted).toBe(false);
      view.unmount();
      expect(signal?.aborted).toBe(true);
    });
  });
});

describe("BulkAddDialog", () => {
  const open = async (episodes: Ep[] = [ep(3)]) => {
    const s = setup(episodes);
    await userEvent.click(screen.getByRole("button", { name: "Add N episodes" }));
    return s;
  };
  const dlg = () => dialog("Add numbered episodes");

  it("creates numbered drafts starting after the last episode", async () => {
    mockApi.post("/v1/admin/series/s1/episodes", { id: "x" });
    const { onChanged } = await open();
    const count = dlg().getByLabelText("How many");
    expect(dlg().getByText("Episodes 4–13 will be created as drafts.")).toBeInTheDocument();
    fireEvent.change(count, { target: { value: "3" } });
    await userEvent.click(dlg().getByRole("button", { name: "Create drafts" }));
    expect(await screen.findByText("Added 3 draft episodes (4–6)")).toBeInTheDocument();
    expect(mockApi.callsTo("POST", "/v1/admin/series/s1/episodes").map((c) => c.body)).toEqual([
      { number: 4, status: "draft" },
      { number: 5, status: "draft" },
      { number: 6, status: "draft" },
    ]);
    expect(onChanged).toHaveBeenCalled();
  });

  it("clamps the count to 1..200", async () => {
    await open([]);
    const count = dlg().getByLabelText("How many") as HTMLInputElement;
    fireEvent.change(count, { target: { value: "999" } });
    expect(count.value).toBe("200");
    fireEvent.change(count, { target: { value: "0" } });
    expect(count.value).toBe("1");
    fireEvent.change(count, { target: { value: "-5" } });
    expect(count.value).toBe("1");
  });

  it("reports a partial failure and still refreshes", async () => {
    let n = 0;
    mockApi.post("/v1/admin/series/s1/episodes", () => (++n === 2 ? fail(409, "number taken") : { id: "x" }));
    const { onChanged } = await open();
    fireEvent.change(dlg().getByLabelText("How many"), { target: { value: "3" } });
    await userEvent.click(dlg().getByRole("button", { name: "Create drafts" }));
    expect(await screen.findByText("number taken — 1 of 3 created")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it("does not refresh when nothing was created", async () => {
    mockApi.post("/v1/admin/series/s1/episodes", fail(500, "down"));
    const { onChanged } = await open();
    await userEvent.click(dlg().getByRole("button", { name: "Create drafts" }));
    expect(await screen.findByText("down — 0 of 10 created")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("can be cancelled", async () => {
    await open();
    await userEvent.click(dlg().getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Add numbered episodes" })).toBeNull();
  });
});
