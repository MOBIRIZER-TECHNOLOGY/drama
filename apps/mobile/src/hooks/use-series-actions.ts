import * as Haptics from "expo-haptics";
import { useCallback, useMemo, useState } from "react";
import { Share } from "react-native";
import { useT } from "@/hooks/use-translations";
import { track } from "@/lib/analytics";
import { api } from "@/lib/api";
import { unwrap } from "@/lib/errors";
import { seriesShareUrl } from "@/lib/format";
import { useAuth } from "@/providers/auth";

/**
 * Favourite / like toggles with optimistic state and a guest sign-in prompt, plus native share.
 *
 * The returned object is memoised: the player hands it to a memoised page component, and a fresh object on
 * every render would re-render that page on every tick of the progress timer.
 */
export function useSeriesActions(seriesId: string, initial: { favorite: boolean; liked: boolean; likeCount: number }) {
  const t = useT();
  const { requireAuth, user } = useAuth();
  const referralCode = user?.referral_code ?? null;
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
      setError(e instanceof Error ? e.message : t("series.favorite_failed"));
    }
  }, [favorite, requireAuth, seriesId, t]);

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
      setError(e instanceof Error ? e.message : t("series.like_failed"));
    }
  }, [liked, requireAuth, seriesId, t]);

  const share = useCallback(
    async (title: string, slug: string, episode?: number) => {
      // The referral code rides along, so a share that converts pays the sharer.
      const url = seriesShareUrl(slug, { episode, ref: referralCode });
      try {
        const result = await Share.share({ message: `${title} — watch on Katha ${url}`, url });
        track("share", { series_id: seriesId, slug, episode: episode ?? null, shared: result.action === Share.sharedAction });
      } catch {
        // The share sheet was dismissed or unavailable.
      }
    },
    [seriesId, referralCode],
  );

  const clearError = useCallback(() => setError(null), []);

  return useMemo(
    () => ({ favorite, liked, likeCount, error, clearError, toggleFavorite, toggleLike, share }),
    [favorite, liked, likeCount, error, clearError, toggleFavorite, toggleLike, share],
  );
}
