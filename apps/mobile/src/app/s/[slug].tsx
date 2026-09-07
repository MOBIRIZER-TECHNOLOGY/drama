import { Redirect, useLocalSearchParams } from "expo-router";

/** Universal link target: https://katha.app/s/{slug} opens the series (the API accepts id or slug). */
export default function SeriesLinkScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <Redirect href={{ pathname: "/series/[id]", params: { id: slug } }} />;
}
