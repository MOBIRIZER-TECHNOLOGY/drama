import { api, ApiError, call, type Schemas } from "./api";
import { startPolling } from "./polling";

export type VideoAsset = Schemas["VideoAssetOut"];

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.ceil(n / 1024)} KB`;
}

function checkSize(file: File, max: number, what: string) {
  if (file.size > max) {
    throw new ApiError(`${what} is ${fmtBytes(file.size)}; the limit is ${fmtBytes(max)}.`, 0, "file_too_large");
  }
  if (file.size === 0) throw new ApiError(`${what} is empty.`, 0, "file_empty");
}

function putWithProgress(url: string, file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiError("Upload cancelled", 0, "upload_cancelled"));
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => signal?.removeEventListener("abort", onAbort);

    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new ApiError(`Upload to storage failed (${xhr.status})`, xhr.status, "upload_failed"));
    };
    xhr.onerror = () => {
      cleanup();
      reject(new ApiError("Upload to storage failed (network or CORS)", 0, "upload_failed"));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new ApiError("Upload cancelled", 0, "upload_cancelled"));
    };
    xhr.send(file);
  });
}

export function isCancelled(e: unknown): boolean {
  return e instanceof ApiError && e.code === "upload_cancelled";
}

/**
 * presign(image) -> PUT -> the object's key, plus a URL for showing it back.
 *
 * The key is what gets stored. Storing the absolute URL was what tied every cover to one hostname, so the CDN
 * could not move and a device and a browser could not both be served from the same row. The API resolves keys
 * against its own media base when it answers.
 */
export async function uploadImage(
  file: File,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ key: string; url: string }> {
  if (!file.type.startsWith("image/")) throw new ApiError("Please choose an image file.", 0, "bad_content_type");
  checkSize(file, MAX_IMAGE_BYTES, "Image");
  const presign = await call(
    api.POST("/v1/admin/uploads/presign", {
      body: { kind: "image", filename: file.name, content_type: file.type || "application/octet-stream" },
    }),
  );
  await putWithProgress(presign.upload_url, file, onProgress, signal);
  if (!presign.public_url) throw new ApiError("Storage returned no public URL for the image", 500, "no_public_url");
  return { key: presign.key, url: presign.public_url };
}

/** presign(video) -> PUT -> register -> VideoAsset (queued). Poll with `pollVideo`. */
export async function uploadVideo(file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<VideoAsset> {
  if (file.type && !file.type.startsWith("video/")) throw new ApiError("Please choose a video file.", 0, "bad_content_type");
  checkSize(file, MAX_VIDEO_BYTES, "Video");
  const presign = await call(
    api.POST("/v1/admin/uploads/presign", {
      body: { kind: "video", filename: file.name, content_type: file.type || "video/mp4" },
    }),
  );
  await putWithProgress(presign.upload_url, file, onProgress, signal);
  if (signal?.aborted) throw new ApiError("Upload cancelled", 0, "upload_cancelled");
  return call(api.POST("/v1/admin/uploads/videos", { body: { key: presign.key, size_bytes: file.size } }));
}

export function getVideo(assetId: string): Promise<VideoAsset> {
  return call(api.GET("/v1/admin/uploads/videos/{asset_id}", { params: { path: { asset_id: assetId } } }));
}

export function retryVideo(assetId: string): Promise<VideoAsset> {
  return call(api.POST("/v1/admin/uploads/videos/{asset_id}/retry", { params: { path: { asset_id: assetId } } }));
}

export const TERMINAL_ASSET_STATUS = new Set<VideoAsset["status"]>(["ready", "failed"]);
export const PENDING_ASSET_STATUS = new Set<VideoAsset["status"]>(["uploaded", "queued", "transcoding"]);

/** Poll one asset until ready/failed (3 s, backing off to 30 s on errors, paused while hidden). */
export function pollVideo(assetId: string, onUpdate: (asset: VideoAsset) => void, onError?: (message: string) => void): () => void {
  return startPolling({
    tick: async () => {
      const asset = await getVideo(assetId);
      onUpdate(asset);
      return TERMINAL_ASSET_STATUS.has(asset.status);
    },
    onError,
  });
}

/**
 * Poll a set of pending asset ids; `onSettled` fires once any of them reaches a terminal state.
 * Stops when the set is exhausted.
 */
export function pollAssets(assetIds: string[], onSettled: (asset: VideoAsset) => void, onError?: (message: string) => void): () => void {
  const pending = new Set(assetIds);
  return startPolling({
    tick: async () => {
      const results = await Promise.all([...pending].map((id) => getVideo(id)));
      for (const a of results) {
        if (TERMINAL_ASSET_STATUS.has(a.status)) {
          pending.delete(a.id);
          onSettled(a);
        }
      }
      return pending.size === 0;
    },
    onError,
  });
}
