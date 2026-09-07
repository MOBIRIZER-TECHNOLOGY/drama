import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import { getAuth, inMemoryPersistence, initializeAuth, type Auth } from "firebase/auth";
import type { FirebaseWebConfig } from "@/lib/types";

const envConfig: FirebaseOptions = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
};

let remoteConfig: FirebaseOptions | null = null;
let app: FirebaseApp | null = null;
let auth: Auth | null = null;

/** `GET /v1/config` may carry the public Firebase web config; it takes precedence over EXPO_PUBLIC_FIREBASE_*. */
export function setRemoteFirebaseConfig(remote: FirebaseWebConfig | null | undefined): void {
  if (!remote?.api_key) {
    remoteConfig = null;
    return;
  }
  remoteConfig = {
    apiKey: remote.api_key,
    authDomain: remote.auth_domain ?? envConfig.authDomain,
    projectId: remote.project_id ?? envConfig.projectId,
    appId: remote.app_id ?? envConfig.appId,
    messagingSenderId: remote.messaging_sender_id ?? envConfig.messagingSenderId,
    storageBucket: envConfig.storageBucket,
  };
}

function activeConfig(): FirebaseOptions {
  return remoteConfig ?? envConfig;
}

export function firebaseConfigured(): boolean {
  const c = activeConfig();
  return Boolean(c.apiKey && c.projectId && c.appId);
}

/**
 * Firebase is only a credential broker here: the session that matters is Katha's own token pair, so Firebase
 * auth state is kept in memory and dropped right after the exchange. Initialised lazily so a missing config
 * only breaks the auth screen, not the whole app.
 */
export function getFirebaseAuth(): Auth {
  if (auth) return auth;
  if (!firebaseConfigured()) {
    throw new Error("Firebase is not configured. Set EXPO_PUBLIC_FIREBASE_API_KEY, _PROJECT_ID and _APP_ID or config.firebase.");
  }
  app = getApps()[0] ?? initializeApp(activeConfig());
  try {
    auth = initializeAuth(app, { persistence: inMemoryPersistence });
  } catch {
    // initializeAuth throws if already initialised (e.g. after a fast refresh).
    auth = getAuth(app);
  }
  return auth;
}

export const googleClientIds = {
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
};

/** The native Google Sign-In SDK needs the web client id to mint an ID token Firebase will accept. */
export const googleConfigured = Boolean(googleClientIds.webClientId);
