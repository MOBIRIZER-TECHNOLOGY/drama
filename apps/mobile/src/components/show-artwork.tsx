import { Image, type ImageProps, type ImageSource } from "expo-image";
import { useState } from "react";

const FALLBACKS = {
  banner: require("../../assets/images/show-fallback-banner.jpg"),
  poster: require("../../assets/images/show-fallback-poster.jpg"),
} as const;

type Props = Omit<ImageProps, "source"> & {
  source?: ImageSource | string | null;
  kind: keyof typeof FALLBACKS;
};

export function ShowArtwork({ source, kind, ...props }: Props) {
  const fallback = FALLBACKS[kind];
  // Which artwork failed, rather than a flag and an effect to clear it when the card is recycled onto another
  // show. A different URL is simply not the one that failed, so the next show gets its own attempt without
  // any state to reset — and a list that reuses rows never briefly shows one show's placeholder for another.
  const [failed, setFailed] = useState<ImageSource | string | null>(null);
  const broken = source != null && failed === source;

  return <Image {...props} source={broken || !source ? fallback : source} onError={() => setFailed(source ?? null)} />;
}
