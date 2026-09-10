"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";

const FALLBACKS = {
  banner: "/images/show-fallback-banner.jpg",
  poster: "/images/show-fallback-poster.jpg",
} as const;

type Props = Omit<ImageProps, "src"> & {
  src?: string | null;
  kind: keyof typeof FALLBACKS;
};

export function ShowArtwork({ src, kind, alt = "", ...props }: Props) {
  const fallback = FALLBACKS[kind];
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const resolvedSrc = src && src !== failedSrc ? src : fallback;

  return <Image {...props} src={resolvedSrc} alt={alt} onError={() => src && setFailedSrc(src)} />;
}
