import { googleClientIds, googleConfigured } from "./firebase";

/**
 * Google sign-in, loaded only when someone reaches for it.
 *
 * The library binds a TurboModule at import time and throws when that module is not present in the binary.
 * A static import therefore stopped the whole sign-in screen from evaluating on any build without it, so
 * email and phone sign-in vanished along with the Google button and the screen rendered nothing at all.
 * Google is one of four ways in. It does not get to take the other three with it.
 *
 * Loading is attempted once and the answer cached, so a build without the module pays for one failed
 * require rather than one per render.
 */
type GoogleModule = typeof import("@react-native-google-signin/google-signin");

let loaded: GoogleModule | null | undefined;

function load(): GoogleModule | null {
  if (loaded !== undefined) return loaded;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require("@react-native-google-signin/google-signin") as GoogleModule;
  } catch {
    loaded = null;
  }
  return loaded;
}

/** Whether this build can run the Google flow at all. Gates the button, not just the call. */
export function googleSignInAvailable(): boolean {
  return googleConfigured && load() !== null;
}

let configured = false;

/**
 * Runs the native flow and returns an ID token to exchange with Firebase.
 *
 * Returns null when the viewer dismissed the sheet, which is not an error and must not surface as one.
 */
export async function googleIdToken(): Promise<string | null> {
  const google = load();
  if (!google) return null;

  if (!configured) {
    google.GoogleSignin.configure({
      webClientId: googleClientIds.webClientId,
      iosClientId: googleClientIds.iosClientId,
    });
    configured = true;
  }

  await google.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const result = await google.GoogleSignin.signIn();
  if (result.type !== "success") return null;

  const idToken = result.data.idToken;
  if (!idToken) throw new Error("Google did not return an ID token");
  return idToken;
}
