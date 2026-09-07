/** Content ratings (CBFC-style, as the API stores them in `content_rating`). Adult ratings gate playback by age confirmation. */
export const CONTENT_RATINGS: readonly { value: string; label: string }[] = [
  { value: "U", label: "Universal" },
  { value: "UA7", label: "Parental guidance, 7+" },
  { value: "UA13", label: "Parental guidance, 13+" },
  { value: "UA16", label: "Parental guidance, 16+" },
  { value: "A", label: "Adults only" },
];

export const ADULT_RATINGS = new Set(["A", "UA16"]);
