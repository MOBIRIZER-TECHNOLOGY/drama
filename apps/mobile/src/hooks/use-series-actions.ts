import * as Haptics from "expo-haptics";
import { useCallback, useState } from "react";
import { Share } from "react-native";
import { track } from "@/lib/analytics";
import { api } from "@/lib/api";
import { unwrap } from "@/lib/errors";
import { seriesShareUrl } from "@/lib/format";
import { useAuth } from "@/providers/auth";

/** Favourite / like toggles with optimistic state and a guest sign-in prompt, plus native share. */
export function useSeriesActions(seriesId: string, initial: { favorite: boolean; liked: boolean; likeCount: number }) {
  const { requireAuth } = useAuth();
  const [favorite, setFavorite] = useState(initial.favorite);
  const [liked, setLiked] = useState(initial.liked);
  const [likeCount, setLikeCount] = useState(initial.likeCount);
  const [error, setError] = useState<string | null>(null);

  const toggleFavorite = useCallback(async () => {
    if (!requireAuth()) return;
    const next = !favorite;
    setFavorite(next);
    Haptics.selectionAsync().catch(() => {});
    try {
      const out = unwrap(await api.POST("/v1/series/{series_id}/favorite", { params: { path: { series_id: seriesId } } }));
      setFavorite(out.active);
    } catch (e) {
      setFavorite(!next);
      setError(e instanceof Error ? e.message : "Could not update favourites");
    }
  }, [favorite, requireAuth, seriesId]);

  const toggleLike = useCallback(async () => {
    if (!requireAuth()) return;
    const next = !liked;
    setLiked(next);
    setLikeCount((c) => Math.max(0, c + (next ? 1 : -1)));
    Haptics.selectionAsync().catch(() => {});
    try {
      const out = unwrap(await api.POST("/v1/series/{series_id}/like", { params: { path: { series_id: seriesId } } }));
      setLiked(out.active);
      if (typeof out.count === "number") setLikeCount(out.count);
    } catch (e) {
      setLiked(!next);
      setLikeCount((c) => Math.max(0, c + (next ? -1 : 1)));
      setError(e instanceof Error ? e.message : "Could not update like");
    }
  }, [liked, requireAuth, seriesId]);

  const share = useCallback(
    async (title: string, slug: string) => {
      try {
        const result = await Share.share({ message: `${title} — watch on Katha ${seriesShareUrl(slug)}`, url: seriesShareUrl(slug) });
        track("share", { series_id: seriesId, slug, shared: result.action === Share.sharedAction });
      } catch {
        // The share sheet was dismissed or unavailable.
      }
    },
    [seriesId],
  );

  return { favorite, liked, likeCount, error, clearError: () => setError(null), toggleFavorite, toggleLike, share };
}
