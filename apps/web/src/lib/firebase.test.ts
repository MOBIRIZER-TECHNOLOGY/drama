import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const initializeApp = vi.fn(() => ({ name: "app" }));
const getApps = vi.fn((): unknown[] => []);
const getAuth = vi.fn(() => ({ auth: true }));
vi.mock("firebase/app", () => ({ initializeApp: (...a: unknown[]) => (initializeApp as (...x: unknown[]) => unknown)(...a), getApps: () => getApps() }));
vi.mock("firebase/auth", () => ({ getAuth: (...a: unknown[]) => (getAuth as (...x: unknown[]) => unknown)(...a) }));

const KEYS = ["API_KEY", "AUTH_DOMAIN", "PROJECT_ID", "APP_ID", "MESSAGING_SENDER_ID", "STORAGE_BUCKET"];
const remote = { api_key: "rk", auth_domain: "rd", project_id: "rp", app_id: "ra", messaging_sender_id: "rm" } as never;

beforeEach(() => {
  vi.resetModules();
  for (const k of KEYS) vi.stubEnv(`NEXT_PUBLIC_FIREBASE_${k}`, "");
});
afterEach(() => vi.unstubAllEnvs());

describe("firebaseConfig", () => {
  it("is null when anything required is missing", async () => {
    const { firebaseConfig, isFirebaseConfigured } = await import("./firebase");
    expect(firebaseConfig()).toBeNull();
    expect(firebaseConfig(null)).toBeNull();
    expect(isFirebaseConfigured({ api_key: "k" } as never)).toBe(false);
  });

  it("uses remote values", async () => {
    const { firebaseConfig, isFirebaseConfigured } = await import("./firebase");
    expect(firebaseConfig(remote)).toEqual({
      apiKey: "rk",
      authDomain: "rd",
      projectId: "rp",
      appId: "ra",
      messagingSenderId: "rm",
      storageBucket: undefined,
    });
    expect(isFirebaseConfigured(remote)).toBe(true);
  });

  it("fills gaps field by field from env and remote wins", async () => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "ek");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "ed");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "ep");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_APP_ID", "ea");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", "em");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", "eb");
    const { firebaseConfig } = await import("./firebase");
    expect(firebaseConfig()).toMatchObject({ apiKey: "ek", messagingSenderId: "em", storageBucket: "eb" });
    expect(firebaseConfig({ api_key: "rk" } as never)).toMatchObject({ apiKey: "rk", authDomain: "ed" });
  });
});

describe("getFirebaseAuth", () => {
  it("returns null when unconfigured", async () => {
    const { getFirebaseAuth } = await import("./firebase");
    expect(await getFirebaseAuth()).toBeNull();
    expect(initializeApp).not.toHaveBeenCalled();
  });

  it("initialises once and returns Auth", async () => {
    const { getFirebaseAuth } = await import("./firebase");
    expect(await getFirebaseAuth(remote)).toEqual({ auth: true });
    await getFirebaseAuth(remote);
    expect(initializeApp).toHaveBeenCalledTimes(1);
    expect(getAuth).toHaveBeenCalledWith({ name: "app" });
  });

  it("reuses an existing app", async () => {
    getApps.mockReturnValue([{ name: "existing" }]);
    const { getFirebaseAuth } = await import("./firebase");
    await getFirebaseAuth(remote);
    expect(initializeApp).not.toHaveBeenCalled();
    expect(getAuth).toHaveBeenCalledWith({ name: "existing" });
  });

  it("returns null on the server", async () => {
    const { getFirebaseAuth } = await import("./firebase");
    vi.stubGlobal("window", undefined);
    try {
      expect(await getFirebaseAuth(remote)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("firebaseErrorMessage", () => {
  const t = (_k: string, fb: string) => fb;
  const cases: [string, RegExp][] = [
    ["auth/invalid-email", /does not look right/],
    ["auth/user-not-found", /incorrect/],
    ["auth/wrong-password", /incorrect/],
    ["auth/invalid-credential", /incorrect/],
    ["auth/email-already-in-use", /already exists/],
    ["auth/weak-password", /6 characters/],
    ["auth/too-many-requests", /Too many/],
    ["auth/popup-closed-by-user", /window was closed/],
    ["auth/cancelled-popup-request", /window was closed/],
    ["auth/popup-blocked", /blocked/],
    ["auth/invalid-phone-number", /international format/],
    ["auth/invalid-verification-code", /not correct/],
    ["auth/code-expired", /expired/],
    ["auth/network-request-failed", /Network error/],
    ["auth/operation-not-allowed", /not enabled/],
    ["auth/weird", /Sign-in failed/],
  ];
  it.each(cases)("%s", async (code, re) => {
    const { firebaseErrorMessage } = await import("./firebase");
    expect(firebaseErrorMessage({ code, message: "sdk english" }, t)).toMatch(re);
  });

  it("passes through codeless app-raised messages, otherwise the generic text", async () => {
    const { firebaseErrorMessage } = await import("./firebase");
    expect(firebaseErrorMessage(new Error("Not configured"), t)).toBe("Not configured");
    expect(firebaseErrorMessage({}, t)).toMatch(/Sign-in failed/);
    expect(firebaseErrorMessage(null, t)).toMatch(/Sign-in failed/);
  });

  it("passes the catalogue key to the translator", async () => {
    const { firebaseErrorMessage } = await import("./firebase");
    const spy = vi.fn(() => "x");
    firebaseErrorMessage({ code: "auth/weak-password" }, spy);
    expect(spy).toHaveBeenCalledWith("auth.error.weak_password", expect.any(String));
  });
});
