import type { CategoryOut, SeriesCard } from "@/lib/types";

export const makeCategory = (over: Partial<CategoryOut> = {}): CategoryOut =>
  ({ id: "c1", slug: "romance", name: "Romance", ...over }) as CategoryOut;

export const makeSeries = (over: Partial<SeriesCard> = {}): SeriesCard =>
  ({
    id: "s1",
    slug: "my-show",
    title: "My Show",
    synopsis: "A story",
    cover_url: "https://cdn.example.com/cover.jpg",
    banner_url: null,
    is_featured: false,
    is_premium: false,
    free_episodes: 0,
    episode_count: 10,
    view_count: 0,
    like_count: 0,
    categories: [],
    released_at: null,
    is_adult: false,
    ...over,
  }) as SeriesCard;
