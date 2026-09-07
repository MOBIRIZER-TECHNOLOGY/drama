"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type FieldErrors<K extends string = string> = Partial<Record<K, string>>;

/**
 * Field-level validation state. Set errors with `setErrors`; the first control marked
 * `aria-invalid` inside `formRef` is focused after the next render.
 */
export function useFieldErrors<K extends string = string>() {
  const [errors, setErrorsState] = useState<FieldErrors<K>>({});
  const [focusTick, setFocusTick] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  const setErrors = useCallback((next: FieldErrors<K>) => {
    setErrorsState(next);
    if (Object.keys(next).length > 0) setFocusTick((t) => t + 1);
  }, []);

  const clearError = useCallback((key: K) => {
    setErrorsState((prev) => {
      if (!(key in prev)) return prev;
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
  }, []);

  useEffect(() => {
    if (focusTick === 0) return;
    const el = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    el?.focus();
    el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  }, [focusTick]);

  const hasErrors = Object.keys(errors).length > 0;
  return { errors, setErrors, clearError, hasErrors, formRef };
}

const EMBED_HOSTS = new Set(["youtube.com", "www.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com", "vimeo.com", "player.vimeo.com", "dailymotion.com", "www.dailymotion.com"]);

/**
 * Accept exactly one <iframe src="https://…"> from an allowed video host (mirrors the API rule).
 * Returns an error message, or null when valid.
 */
export function validateEmbedHtml(html: string): string | null {
  const text = html.trim();
  if (!text) return "Paste an <iframe> embed.";
  if (typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(text, "text/html");
  const body = doc.body;
  const elements = Array.from(body.children);
  const stray = Array.from(body.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
  if (elements.length !== 1 || stray || elements[0].tagName !== "IFRAME") {
    return "Only a single <iframe> element is allowed.";
  }
  const iframe = elements[0] as HTMLIFrameElement;
  if (iframe.querySelector("*")) return "The <iframe> must not contain other elements.";
  const src = iframe.getAttribute("src") ?? "";
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return "The iframe needs an absolute https:// src.";
  }
  if (url.protocol !== "https:") return "The iframe src must use https://.";
  if (!EMBED_HOSTS.has(url.hostname.toLowerCase())) {
    return "Only YouTube, YouTube (no-cookie), Vimeo and Dailymotion embeds are allowed.";
  }
  for (const attr of Array.from(iframe.attributes)) {
    if (/^on/i.test(attr.name) || attr.name.toLowerCase() === "srcdoc") return `Attribute ${attr.name} is not allowed.`;
  }
  return null;
}
