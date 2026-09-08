"use client";

import { useEffect, useRef, useState } from "react";
import { isCancelled, MAX_IMAGE_BYTES, uploadImage } from "@/lib/uploads";
import { useToast } from "./toast";
import { Icon } from "./icons";
import { Button, Input } from "./ui";

/**
 * Where uploaded images can be read back from, for previews only.
 *
 * The field stores a key, and a key is not something an <img> can load, so the console needs to know the
 * media base to show one. This is display-only: nothing composed here is ever saved.
 */
const MEDIA_BASE = (process.env.NEXT_PUBLIC_MEDIA_BASE ?? "").replace(/\/$/, "");

/**
 * Image field: presign -> PUT -> public_url. Also accepts a pasted URL.
 * `aspect` controls the preview frame (portrait 9:16 for covers, wide for banners).
 * An in-flight upload is aborted when the component unmounts.
 */
export function ImageUpload({
  label,
  value,
  onChange,
  aspect = "portrait",
  hint,
}: {
  label: string;
  value: string | null | undefined;
  onChange: (url: string | null) => void;
  aspect?: "portrait" | "wide" | "square";
  hint?: string;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  /** Set right after an upload, because `value` is then a key and a key is not something an <img> can load. */
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  // A stored value is a key; a pasted one may already be a URL. Either way the preview needs something
  // absolute, and a fresh upload has one to hand.
  const previewSrc = preview ?? (value && /^(https?:)?\/\//.test(value) ? value : value ? `${MEDIA_BASE}/${value.replace(/^\//, "")}` : null);

  const frame =
    aspect === "portrait" ? "aspect-[9/16] w-28" : aspect === "wide" ? "aspect-[16/9] w-full max-w-sm" : "aspect-square w-28";

  async function pick(file: File | undefined) {
    if (!file) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress(0);
    try {
      const { key, url } = await uploadImage(file, setProgress, controller.signal);
      // Store the key; keep the URL only so the preview has something to show before the next save.
      onChange(key);
      setPreview(url);
      toast.success(`${label} uploaded`);
    } catch (e) {
      if (!isCancelled(e)) toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-medium text-ink-2">{label}</span>
      <div className="flex flex-wrap items-start gap-4">
        <div
          className={`${frame} relative shrink-0 overflow-hidden rounded-lg border border-line bg-surface-2`}
          aria-busy={progress != null}
        >
          {previewSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote bucket URLs; no optimisation needed in admin
            <img src={previewSrc} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center text-muted">
              <Icon name="upload" size={20} />
            </div>
          )}
          {progress != null && (
            <div className="absolute inset-x-0 bottom-0 h-1.5 bg-line">
              <div className="h-full bg-accent transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              aria-label={`${label} file`}
              className="sr-only"
              onChange={(e) => pick(e.target.files?.[0])}
            />
            <Button size="sm" loading={progress != null} onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={14} /> {value ? "Replace" : "Upload"}
            </Button>
            {progress != null && (
              <Button size="sm" variant="ghost" onClick={() => abortRef.current?.abort()}>
                Cancel
              </Button>
            )}
            {value && progress == null && (
              <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
                Remove
              </Button>
            )}
          </div>
          <Input
            aria-label={`${label} URL`}
            placeholder="https://… (or upload)"
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value || null)}
            className="h-9 text-xs"
          />
          <span className="text-xs text-muted">{hint ?? `Up to ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB.`}</span>
        </div>
      </div>
    </div>
  );
}
