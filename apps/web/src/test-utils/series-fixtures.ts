import type { EpisodeOut, SeriesDetail } from "@/lib/types";

export function ep(number: number, over: Partial<EpisodeOut> = {}): EpisodeOut {
  return {
    id: `ep-${number}`,
    number,
    title: null,
    thumbnail_url: null,
    duration_sec: 60,
    is_free: false,
    price: 10,
    accessible: false,
    unlocked: false,
    ...over,
  };
}

export function seriesDetail(over: Partial<SeriesDetail> = {}): SeriesDetail {
  return {
    id: "s1",
    slug: "my-show",
    title: "My Show",
    synopsis: "A synopsis",
    cover_url: null,
    banner_url: null,
    is_featured: false,
    is_premium: false,
    free_episodes: 2,
    episode_count: 4,
    view_count: 1200,
    like_count: 30,
    categories: [],
    released_at: null,
    is_adult: false,
    seo_title: null,
    meta_description: null,
    episodes: [ep(1, { is_free: true }), ep(2, { is_free: true }), ep(3), ep(4)],
    is_favorite: false,
    is_liked: false,
    continue_episode_number: null,
    similar: [],
    ...over,
  } as SeriesDetail;
}
