import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fail, mockApi } from "@/test/api";
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  getVideo,
  isCancelled,
  pollAssets,
  pollVideo,
  retryVideo,
  uploadImage,
  uploadVideo,
} from "./uploads";

/** Minimal XHR double: records the request and lets a test finish it. */
class FakeXhr {
  static last: FakeXhr;
  method = "";
  url = "";
  headers: Record<string, string> = {};
  sent: unknown;
  status = 200;
  upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  aborted = false;
  constructor() {
    FakeXhr.last = this;
  }
  open(m: string, u: string) {
    this.method = m;
    this.url = u;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(b: unknown) {
    this.sent = b;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
}

const file = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type });
const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => vi.stubGlobal("XMLHttpRequest", FakeXhr));
afterEach(() => vi.unstubAllGlobals());

describe("uploadImage", () => {
  it("rejects non-images, empty and oversized files before any request", async () => {
    await expect(uploadImage(file("a.txt", "text/plain"))).rejects.toMatchObject({ code: "bad_content_type" });
    await expect(uploadImage(file("a.png", "image/png", 0))).rejects.toMatchObject({ code: "file_empty" });
    const big = file("a.png", "image/png", 1);
    Object.defineProperty(big, "size", { value: MAX_IMAGE_BYTES + 1 });
    await expect(uploadImage(big)).rejects.toMatchObject({ code: "file_too_large", message: "Image is 10.0 MB; the limit is 10.0 MB." });
    expect(mockApi.calls).toHaveLength(0);
  });

  it("presigns, PUTs with progress and returns key and public url", async () => {
    mockApi.post("/v1/admin/uploads/presign", { upload_url: "https://s3/put", key: "k/1.png", public_url: "https://cdn/k/1.png" });
    const progress = vi.fn();
    const f = file("a.png", "image/png");
    const p = uploadImage(f, progress);
    await tick();
    const x = FakeXhr.last;
    expect(x.method).toBe("PUT");
    expect(x.url).toBe("https://s3/put");
    expect(x.headers["Content-Type"]).toBe("image/png");
    expect(x.sent).toBe(f);
    x.upload.onprogress!({ lengthComputable: true, loaded: 1, total: 4 });
    x.upload.onprogress!({ lengthComputable: false, loaded: 1, total: 0 });
    expect(progress).toHaveBeenCalledTimes(1);
    expect(progress).toHaveBeenCalledWith(0.25);
    x.onload!();
    await expect(p).resolves.toEqual({ key: "k/1.png", url: "https://cdn/k/1.png" });
    expect(mockApi.calls[0].body).toEqual({ kind: "image", filename: "a.png", content_type: "image/png" });
  });

  it("works without a progress callback and fails when storage returns no public url", async () => {
    mockApi.post("/v1/admin/uploads/presign", { upload_url: "https://s3/put", key: "k", public_url: null });
    const p = uploadImage(file("a.png", "image/png"));
    p.catch(() => {});
    await tick();
    FakeXhr.last.upload.onprogress!({ lengthComputable: true, loaded: 1, total: 2 });
    FakeXhr.last.onload!();
    await expect(p).rejects.toMatchObject({ code: "no_public_url", status: 500 });
  });

  it("reports storage failures (status and network) and API presign failures", async () => {
    mockApi.post("/v1/admin/uploads/presign", { upload_url: "https://s3/put", key: "k", public_url: "u" });
    let p = uploadImage(file("a.png", "image/png"));
    p.catch(() => {});
    await tick();
    FakeXhr.last.status = 403;
    FakeXhr.last.onload!();
    await expect(p).rejects.toMatchObject({ code: "upload_failed", status: 403, message: "Upload to storage failed (403)" });

    p = uploadImage(file("a.png", "image/png"));
    p.catch(() => {});
    await tick();
    FakeXhr.last.onerror!();
    await expect(p).rejects.toMatchObject({ code: "upload_failed", message: /network or CORS/ });

    mockApi.post("/v1/admin/uploads/presign", fail(500, "no bucket"));
    await expect(uploadImage(file("a.png", "image/png"))).rejects.toMatchObject({ message: "no bucket" });
  });

  it("cancels via an already-aborted signal or an abort mid-flight", async () => {
    mockApi.post("/v1/admin/uploads/presign", { upload_url: "https://s3/put", key: "k", public_url: "u" });
    const pre = new AbortController();
    pre.abort();
    const early = await uploadImage(file("a.png", "image/png"), undefined, pre.signal).catch((e) => e);
    expect(isCancelled(early)).toBe(true);

    const ctl = new AbortController();
    const p = uploadImage(file("a.png", "image/png"), undefined, ctl.signal);
    p.catch(() => {});
    await tick();
    ctl.abort();
    expect(FakeXhr.last.aborted).toBe(true);
    await expect(p).rejects.toMatchObject({ code: "upload_cancelled" });
    expect(isCancelled(new Error("x"))).toBe(false);
  });
});

describe("uploadVideo", () => {
  it("validates type and size", async () => {
    await expect(uploadVideo(file("a.png", "image/png"))).rejects.toMatchObject({ code: "bad_content_type" });
    await expect(uploadVideo(file("a.mp4", "video/mp4", 0))).rejects.toMatchObject({ code: "file_empty" });
    const big = file("a.mp4", "video/mp4", 1);
    Object.defineProperty(big, "size", { value: MAX_VIDEO_BYTES + 1 });
    await expect(uploadVideo(big)).rejects.toMatchObject({ message: expect.stringContaining("GB") });
  });

  it("presigns, uploads and registers the asset (typeless files default to video/mp4)", async () => {
    mockApi.post("/v1/admin/uploads/presign", { upload_url: "https://s3/v", key: "v/1.mp4" });
    mockApi.post("/v1/admin/uploads/videos", { id: "asset1", status: "queued" });
    const f = file("clip", "", 5);
    const p = uploadVideo(f);
    await tick();
    expect(FakeXhr.last.headers["Content-Type"]).toBe("application/octet-stream");
    FakeXhr.last.onload!();
    await expect(p).resolves.toEqual({ id: "asset1", status: "queued" });
    expect(mockApi.callsTo("POST", "/v1/admin/uploads/presign")[0].body).toEqual({ kind: "video", filename: "clip", content_type: "video/mp4" });
    expect(mockApi.callsTo("POST", "/v1/admin/uploads/videos")[0].body).toEqual({ key: "v/1.mp4", size_bytes: 5 });
  });

  it("does not register when aborted just after the PUT finished", async () => {
    mockApi.post("/v1/admin/uploads/presign", { upload_url: "https://s3/v", key: "v/1.mp4" });
    const ctl = new AbortController();
    const p = uploadVideo(file("a.mp4", "video/mp4"), undefined, ctl.signal);
    p.catch(() => {});
    await tick();
    // finish the upload and abort in the same turn: the xhr already completed, so only the signal check can catch it
    FakeXhr.last.onload!();
    ctl.abort();
    await expect(p).rejects.toMatchObject({ code: "upload_cancelled" });
    expect(mockApi.callsTo("POST", "/v1/admin/uploads/videos")).toHaveLength(0);
  });
});

describe("video endpoints and polling", () => {
  it("gets and retries an asset", async () => {
    mockApi.get("/v1/admin/uploads/videos/a1", { id: "a1", status: "ready" });
    mockApi.post("/v1/admin/uploads/videos/a1/retry", { id: "a1", status: "queued" });
    expect((await getVideo("a1")).status).toBe("ready");
    expect((await retryVideo("a1")).status).toBe("queued");
  });

  describe("polling", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("pollVideo reports every update until a terminal status", async () => {
      const seq = ["queued", "transcoding", "ready"];
      mockApi.get("/v1/admin/uploads/videos/a1", () => ({ id: "a1", status: seq.shift() }));
      const onUpdate = vi.fn();
      pollVideo("a1", onUpdate);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(onUpdate.mock.calls.map((c) => c[0].status)).toEqual(["queued", "transcoding", "ready"]);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(onUpdate).toHaveBeenCalledTimes(3);
    });

    it("pollVideo reports errors", async () => {
      mockApi.get("/v1/admin/uploads/videos/a1", fail(500, "down"));
      const onError = vi.fn();
      const stop = pollVideo("a1", vi.fn(), onError);
      await vi.advanceTimersByTimeAsync(0);
      expect(onError).toHaveBeenCalledWith("down");
      stop();
    });

    it("pollAssets settles each asset once and stops when none are pending", async () => {
      const state: Record<string, string[]> = { a: ["transcoding", "ready"], b: ["failed"] };
      mockApi.get("/v1/admin/uploads/videos/*", (c) => {
        const id = c.path.split("/").pop()!;
        return { id, status: state[id].length > 1 ? state[id].shift() : state[id][0] };
      });
      const settled = vi.fn();
      pollAssets(["a", "b"], settled);
      await vi.advanceTimersByTimeAsync(0);
      expect(settled.mock.calls.map((c) => c[0].id)).toEqual(["b"]);
      await vi.advanceTimersByTimeAsync(3000);
      expect(settled.mock.calls.map((c) => c[0].id)).toEqual(["b", "a"]);
      const n = mockApi.calls.length;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(mockApi.calls).toHaveLength(n);
    });
  });
});
