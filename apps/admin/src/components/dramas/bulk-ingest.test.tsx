import "@/test/dramas-dom-matchers";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { uploadVideo } from "@/lib/uploads";
import { fail, mockApi } from "@/test/api";
import { renderPage } from "@/test/render";
import { BulkIngestDialog, numberFromFilename } from "./bulk-ingest";

vi.mock("@/lib/uploads", async (orig) => ({ ...(await orig<typeof import("@/lib/uploads")>()), uploadVideo: vi.fn() }));
const upload = vi.mocked(uploadVideo);

const video = (name: string, size = 10) => new File([new Uint8Array(size)], name, { type: "video/mp4" });
const ep = (number: number, over: Record<string, unknown> = {}) =>
  ({ id: `e${number}`, number, title: `Ep ${number}`, thumbnail_url: "t.jpg", price_override: 5, is_free_override: true, ...over }) as never;

function setup(existing: unknown[] = [], over: { onClose?: () => void; onDone?: () => void } = {}) {
  const onClose = over.onClose ?? vi.fn();
  const onDone = over.onDone ?? vi.fn();
  renderPage(<BulkIngestDialog open seriesId="s1" existing={existing as never} onClose={onClose} onDone={onDone} />);
  return { onClose, onDone };
}
const fileInput = () => document.querySelector("input[type=file]") as HTMLInputElement;
const pickFiles = (...f: File[]) => userEvent.upload(fileInput(), f);
const rowTexts = () => within(screen.getByRole("list")).getAllByRole("listitem").map((li) => li.textContent);

beforeEach(() => {
  upload.mockImplementation(async (file) => ({ id: `asset-${file.name}` }) as never);
  mockApi.post("/v1/admin/series/s1/episodes", { id: "new" });
  mockApi.put("/v1/admin/episodes/*", { id: "x" });
});
afterEach(() => vi.useRealTimers());

describe("numberFromFilename", () => {
  it.each([
    ["01.mp4", 1],
    ["ep_12.mp4", 12],
    ["Show - 07.mp4", 7],
    ["Show 2024 - 05 1080p x264.mkv", 5],
    ["clip 720p.mp4", null],
    ["intro.mp4", null],
    ["0000.mp4", null],
    ["noext 3", 3],
  ])("%s -> %s", (name, expected) => expect(numberFromFilename(name)).toBe(expected));
});

describe("BulkIngestDialog", () => {
  it("lists picked files sorted by episode number with fallback numbering and duplicate handling", async () => {
    setup([ep(1), ep(2)]);
    await pickFiles(video("zeta.mp4"), video("05.mp4"), video("alpha.mp4"), video("ep 02.mp4"), video("ep_05b.mp4"));
    const texts = rowTexts();
    // parsed numbers first (2, 5, 5), then unnamed files take the first free slots (3, 4).
    expect(texts[0]).toContain("#2");
    expect(texts[0]).toContain("exists · will skip");
    expect(texts[1]).toContain("#5");
    expect(texts[2]).toContain("#5");
    expect(texts[2]).toContain("Same number as another file");
    expect(texts[3]).toContain("#3");
    expect(texts[3]).toContain("alpha.mp4");
    expect(texts[4]).toContain("#4");
    expect(screen.getByRole("button", { name: "Ingest 3 files" })).toBeInTheDocument();
  });

  it("ignores an empty selection and files that are empty or too large", async () => {
    setup();
    const huge = video("09.mp4");
    Object.defineProperty(huge, "size", { value: 3 * 1024 ** 3 });
    await pickFiles(video("08.mp4", 0), huge);
    expect(screen.queryByRole("list")).toBeNull();
    await pickFiles();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByRole("button", { name: /Ingest\s+files/ })).toBeDisabled();
  });

  it("ingests new episodes with the chosen status and reports success", async () => {
    const { onDone } = setup();
    await userEvent.selectOptions(screen.getByLabelText("Publish as"), "published");
    await pickFiles(video("01.mp4"));
    expect(screen.getByRole("button", { name: "Ingest 1 file" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ingest 1 file" }));

    expect(await screen.findByText("1 episode ingested")).toBeInTheDocument();
    expect(mockApi.callsTo("POST", "/v1/admin/series/s1/episodes")[0].body).toEqual({
      number: 1,
      status: "published",
      video_asset_id: "asset-01.mp4",
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(rowTexts()[0]).toContain("done");
  });

  it("schedules a drip release (review status, staggered scheduled_at) and locks the status select", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    setup();
    await pickFiles(video("01.mp4"), video("02.mp4"));
    await userEvent.selectOptions(screen.getByLabelText("Release one every"), "3");
    expect(screen.getByLabelText("Publish as")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Ingest 2 files" }));
    await screen.findByText("2 episodes ingested");
    const bodies = mockApi.callsTo("POST", "/v1/admin/series/s1/episodes").map((c) => c.body);
    const byNumber = Object.fromEntries(bodies.map((b) => [b.number, b]));
    expect(byNumber[1]).toMatchObject({ status: "review", scheduled_at: "2026-01-01T00:00:00.000Z" });
    expect(byNumber[2]).toMatchObject({ status: "review", scheduled_at: "2026-01-04T00:00:00.000Z" });
  });

  it("skips existing episodes by default and sends no request for them", async () => {
    const { onDone } = setup([ep(1)]);
    await pickFiles(video("01.mp4"));
    expect(screen.getByRole("button", { name: /Ingest\s+files/ })).toBeDisabled();
    // force run via toggling on then off is not needed; skipped rows never upload
    expect(upload).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("in a mixed drop, uploads only the new file and marks the existing one skipped", async () => {
    setup([ep(1)]);
    await pickFiles(video("01.mp4"), video("02.mp4"));
    await userEvent.click(screen.getByRole("button", { name: "Ingest 1 file" }));
    await screen.findByText("1 episode ingested");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(rowTexts()[0]).toContain("Episode 1 already exists");
    expect(mockApi.callsTo("PUT")).toHaveLength(0);
  });

  it("replaces an existing episode's video when the toggle is on, keeping its metadata", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-02-01T00:00:00.000Z"));
    setup([ep(1)]);
    await pickFiles(video("01.mp4"));
    await userEvent.click(screen.getByRole("switch"));
    expect(rowTexts()[0]).toContain("will replace");
    await userEvent.click(screen.getByRole("button", { name: "Ingest 1 file" }));
    await screen.findByText("1 episode ingested");
    expect(mockApi.callsTo("PUT", "/v1/admin/episodes/e1")[0].body).toEqual({
      number: 1,
      title: "Ep 1",
      thumbnail_url: "t.jpg",
      video_asset_id: "asset-01.mp4",
      embed_html: null,
      price_override: 5,
      is_free_override: true,
      status: "draft",
      scheduled_at: null,
    });
  });

  it("replace with drip scheduling and null metadata falls back to nulls", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-02-01T00:00:00.000Z"));
    setup([{ id: "e1", number: 1 }]);
    await pickFiles(video("01.mp4"));
    await userEvent.click(screen.getByRole("switch"));
    await userEvent.selectOptions(screen.getByLabelText("Release one every"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Ingest 1 file" }));
    await screen.findByText("1 episode ingested");
    expect(mockApi.callsTo("PUT", "/v1/admin/episodes/e1")[0].body).toMatchObject({
      title: null,
      thumbnail_url: null,
      price_override: null,
      is_free_override: null,
      status: "review",
      scheduled_at: "2026-02-01T00:00:00.000Z",
    });
  });

  it("marks a failing file as an error while others succeed", async () => {
    upload.mockImplementation(async (file) => {
      if (file.name === "02.mp4") throw new ApiError("Upload to storage failed (500)", 500, "upload_failed");
      if (file.name === "03.mp4") throw "weird";
      return { id: `asset-${file.name}` } as never;
    });
    const { onDone } = setup();
    await pickFiles(video("01.mp4"), video("02.mp4"), video("03.mp4"));
    await userEvent.click(screen.getByRole("button", { name: "Ingest 3 files" }));
    expect(await screen.findByText("1 episode ingested, 2 failed")).toBeInTheDocument();
    const texts = rowTexts();
    expect(texts[1]).toContain("Upload to storage failed (500)");
    expect(texts[2]).toContain("Upload failed");
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("reports when every upload fails and does not call onDone", async () => {
    mockApi.post("/v1/admin/series/s1/episodes", fail(409, "dup"));
    const { onDone } = setup();
    await pickFiles(video("01.mp4"), video("02.mp4"));
    await userEvent.click(screen.getByRole("button", { name: "Ingest 2 files" }));
    expect(await screen.findByText("All 2 uploads failed")).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("shows progress, caps concurrency at 3, and Stop cancels in-flight uploads", async () => {
    let active = 0;
    let maxActive = 0;
    upload.mockImplementation((file, onProgress, signal) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      onProgress?.(0.5);
      return new Promise((_res, rej) => {
        signal?.addEventListener("abort", () => {
          active -= 1;
          rej(new ApiError("Upload cancelled", 0, "upload_cancelled"));
        });
      });
    });
    const { onClose } = setup();
    await pickFiles(video("01.mp4"), video("02.mp4"), video("03.mp4"), video("04.mp4"));
    await userEvent.click(screen.getByRole("button", { name: "Ingest 4 files" }));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(3));
    expect(maxActive).toBe(3);
    expect(screen.getAllByText("50%")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Uploading 0/4" })).toBeDisabled();
    expect(fileInput()).toBeDisabled();
    // dialog cannot be closed while busy
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(screen.getAllByText("Cancelled").length).toBeGreaterThanOrEqual(3));
    // the fourth file never starts once aborted
    expect(upload).toHaveBeenCalledTimes(3);
    expect(mockApi.callsTo("POST", "/v1/admin/series/s1/episodes")).toHaveLength(0);
  });

  it("clears the rows and calls onClose when closed while idle", async () => {
    const { onClose } = setup();
    await pickFiles(video("01.mp4"));
    expect(screen.getByRole("list")).toBeInTheDocument();
    await act(async () => screen.getAllByRole("button", { name: "Close" })[0].click());
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("does nothing when run has no rows", async () => {
    setup();
    expect(screen.getByRole("button", { name: /Ingest\s+files/ })).toBeDisabled();
  });
});
