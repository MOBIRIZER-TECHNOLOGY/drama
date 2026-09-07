import { Redirect } from "expo-router";

/** Unknown deep links and stale routes land on the tabs instead of an error screen. */
export default function NotFoundScreen() {
  return <Redirect href="/(tabs)" />;
}
