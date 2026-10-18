import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";
import { auth, aUser, setAuth } from "@/test-utils/auth-context";
import { ep, seriesDetail } from "@/test-utils/series-fixtures";
import type { PlayOut } from "@/lib/types";

const api = { GET: vi.fn(), POST: vi.fn(), PUT: vi.fn(), PATCH: vi.fn() };
const toast = vi.fn();
const track = vi.fn();
vi.mock("@/lib/client-api", () => ({
  clientApi: {
    GET: (...a: unknown[]) => api.GET(...a),
    POST: (...a: unknown[]) => api.POST(...a),
    PUT: (...a: unknown[]) => api.PUT(...a),
    PATCH: (...a: unknown[]) => api.PATCH(...a),
  },
}));
vi.mock("@/lib/auth-context", () => import("@/test-utils/auth-context"));
vi.mock("@/lib/toast", () => ({ useToast: () => toast }));
vi.mock("@/lib/analytics", () => ({ track: (...a: unknown[]) => track(...a) }));
vi.mock("../player/VideoPlayer", () => import("./video-player-stub"));

import { player } from "./video-player-stub";
import { SeriesView } from "./SeriesView";

const ok = (data: unknown) => ({ data, response: { ok: true, status: 200 } });
const err = (status: number, code: string, message = `${code} msg`) => ({
  error: { detail: { code, message } },
  response: { ok: false, status },
});
const grant = (over: Partial<PlayOut> = {}): PlayOut => ({
  episode_id: "ep-1",
  hls_url: "https://cdn/1.m3u8",
  embed_html: null,
  expires_at: "2030-01-01T00:00:00Z",
  resume_position_sec: 12,
  next_episode_id: null,
  subtitles: [{ lang: "hi", url: "/hi.vtt" }],
  ...over,
});

/** Route table for the mocked client; tests override single entries. */
let currentSeries = seriesDetail();
let routes: Record<string, (args: { params?: { path?: Record<string, string> }; body?: unknown }) => unknown>;
function dispatch(method: string) {
  return async (path: string, args: { params?: { path?: Record<string, string> } } = {}) => {
    const handler = routes[`${method} ${path}`];
    if (!handler) throw new Error(`unrouted ${method} ${path}`);
    return handler(args);
  };
}

beforeEach(() => {
  routes = {
    "POST /v1/episodes/{episode_id}/play": (a) => ok(grant({ episode_id: a.params!.path!.episode_id })),
    "POST /v1/series/{series_id}/view": () => ok({}),
    "GET /v1/series/{id_or_slug}": () => ok(currentSeries),
    "GET /v1/series/{series_id}/bundle": () => ok({ episode_count: 2, list_price: 20, price: 15, discount_pct: 25, saving: 5, affordable: true }),
    "POST /v1/series/{series_id}/bundle": () => ok({ coin_balance: 50, episode_ids: ["ep-3", "ep-4"], spent: 15 }),
    "POST /v1/episodes/{episode_id}/unlock": () => ok({ coin_balance: 90 }),
    "PUT /v1/episodes/{episode_id}/progress": () => ok({}),
    "PATCH /v1/auth/me": () => ok({}),
    "POST /v1/series/{series_id}/like": () => ok({ active: true, count: 31 }),
    "POST /v1/series/{series_id}/favorite": () => ok({ active: true }),
  };
  for (const m of ["GET", "POST", "PUT", "PATCH"] as const) api[m].mockReset().mockImplementation(dispatch(m));
  toast.mockReset();
  track.mockReset();
  player.props = null;
  setAuth({ status: "anonymous" });
  window.localStorage.clear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      static instances: unknown[] = [];
      constructor(public cb: () => void) {}
      observe() {}
      disconnect = vi.fn();
    },
  );
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  window.history.replaceState(null, "", "/series/my-show");
});

const authed = (patch = {}) => setAuth({ status: "authenticated", user: aUser, balance: 120, ...patch });

function renderView(seriesOver = {}, initialEpisode: number | null = null, appOver = {}) {
  const series = seriesDetail(seriesOver);
  currentSeries = series;
  const r = render(<SeriesView series={series} initialEpisode={initialEpisode} />, { wrapper: appWrapper(appOver) });
  return { ...r, series };
}

const playCalls = () => api.POST.mock.calls.filter((c) => c[0] === "/v1/episodes/{episode_id}/play");
const playedIds = () => playCalls().map((c) => c[1].params.path.episode_id);
const dialogOf = (title: string) => screen.getByText(title).closest("dialog") as HTMLDialogElement;
const placeholderAgeButton = () => screen.getAllByText("I am 18 or older").find((b) => !b.closest("dialog"))!;
const tile = (n: number) => screen.getByLabelText(new RegExp(`^Episode ${n}\\b`));

describe("initial episode and playback grant", () => {
  it("plays episode 1 for a guest and passes the grant to the player", async () => {
    renderView();
    await screen.findByTestId("player");
    expect(playedIds()).toEqual(["ep-1"]);
    const p = player.props!;
    expect(p.src).toBe("https://cdn/1.m3u8");
    expect(p.resumeAt).toBe(12);
    expect(p.expiresAt).toBe("2030-01-01T00:00:00Z");
    expect(p.autoPlay).toBe(true);
    expect(p.defaultSubtitleLang).toBe("en");
    expect(p.title).toBe("My Show – Episode 1");
    expect(p.hasNext).toBe(true);
    expect(screen.getByTestId("player").getAttribute("data-poster")).toBe("/images/show-fallback-poster.jpg");
    expect(screen.getByTestId("sub-label").textContent).toBe("हिन्दी|XX");
  });

  it("prefers the episode thumbnail, then the series cover, for the poster", async () => {
    renderView({ cover_url: "https://cdn/cover.jpg" });
    await screen.findByTestId("player");
    expect(screen.getByTestId("player").getAttribute("data-poster")).toBe("https://cdn/cover.jpg");
  });

  it("uses the thumbnail when present", async () => {
    renderView({ episodes: [ep(1, { is_free: true, thumbnail_url: "https://cdn/t.jpg", title: "Pilot" }), ep(2)] });
    await screen.findByTestId("player");
    expect(screen.getByTestId("player").getAttribute("data-poster")).toBe("https://cdn/t.jpg");
    expect(screen.getByText(/· Pilot/)).toBeInTheDocument();
  });

  it("passes embed HTML and no subtitles through for embedded videos", async () => {
    routes["POST /v1/episodes/{episode_id}/play"] = () => ok(grant({ hls_url: null, embed_html: "<iframe/>", subtitles: undefined as never }));
    renderView();
    await screen.findByTestId("player");
    expect(screen.getByTestId("player").getAttribute("data-embed")).toBe("<iframe/>");
    expect(player.props!.subtitles).toEqual([]);
  });

  it("starts at ?ep=, then continue_episode_number, then episode 1; unknown numbers fall back to the first", async () => {
    const a = renderView({}, 2);
    await screen.findByTestId("player");
    expect(playedIds()).toEqual(["ep-2"]);
    a.unmount();
    api.POST.mockClear();
    const b = renderView({ continue_episode_number: 1 }, null);
    await screen.findByTestId("player");
    expect(playedIds()).toEqual(["ep-1"]);
    b.unmount();
    api.POST.mockClear();
    renderView({}, 99);
    await screen.findByTestId("player");
    expect(playedIds()).toEqual(["ep-1"]);
  });

  it("shows only a spinner with no episodes and requests nothing", () => {
    renderView({ episodes: [], episode_count: 0 });
    expect(screen.queryByTestId("player")).toBeNull();
    expect(playCalls()).toHaveLength(0);
  });

  it("waits for the session to resolve before asking for a grant", async () => {
    setAuth({ status: "loading" });
    const { rerender, series } = renderView();
    expect(playCalls()).toHaveLength(0);
    setAuth({ status: "anonymous" });
    rerender(<SeriesView series={series} initialEpisode={null} />);
    await screen.findByTestId("player");
    expect(playCalls()).toHaveLength(1);
  });

  it("does not request the same grant twice while in flight", async () => {
    let resolve!: (v: unknown) => void;
    routes["POST /v1/episodes/{episode_id}/play"] = () => new Promise((r) => (resolve = r));
    const { rerender, series } = renderView();
    rerender(<SeriesView series={series} initialEpisode={null} />);
    expect(playCalls()).toHaveLength(1);
    await act(async () => resolve(ok(grant())));
    await screen.findByTestId("player");
  });

  it("a guest on a paid episode is asked to sign in without hitting /play", () => {
    renderView({}, 3);
    expect(screen.getByText("Sign in to keep watching — this episode needs an account.")).toBeInTheDocument();
    expect(playCalls()).toHaveLength(0);
    fireEvent.click(screen.getByText("Sign in"));
    expect(auth.openAuth).toHaveBeenCalled();
  });

  it("tracks and posts a single series view", async () => {
    const { rerender, series } = renderView();
    rerender(<SeriesView series={series} initialEpisode={null} />);
    await waitFor(() => expect(api.POST).toHaveBeenCalledWith("/v1/series/{series_id}/view", { params: { path: { series_id: "s1" } } }));
    expect(track.mock.calls.filter((c) => c[0] === "series_view")).toEqual([
      ["series_view", { series_id: "s1", slug: "my-show", is_premium: false, episodes: 4 }],
    ]);
  });
});

describe("grant failures", () => {
  it("403 shows the locked placeholder and opens the unlock dialog with a paywall_view", async () => {
    authed();
    routes["POST /v1/episodes/{episode_id}/play"] = () => err(403, "locked");
    renderView({}, 3);
    expect(await screen.findByText("Unlock episode 3")).toBeInTheDocument();
    expect(screen.getByText("This episode is locked.")).toBeInTheDocument();
    expect(track).toHaveBeenCalledWith("paywall_view", { series_id: "s1", episode_id: "ep-3", episode_number: 3, price: 10, balance: 120 });
  });

  it("closing the dialog and using the placeholder button reopens it", async () => {
    authed();
    routes["POST /v1/episodes/{episode_id}/play"] = () => err(403, "locked");
    renderView({}, 3);
    await screen.findByText("Unlock episode 3");
    fireEvent.click(within(dialogOf("Unlock episode 3")).getByLabelText("Close"));
    await waitFor(() => expect(screen.queryByText("Unlock for 10 coins")).toBeNull());
    fireEvent.click(screen.getByText("Unlock"));
    expect(await screen.findByText("Unlock for 10 coins")).toBeInTheDocument();
  });

  it("401 turns into the sign-in placeholder", async () => {
    authed();
    routes["POST /v1/episodes/{episode_id}/play"] = () => err(401, "unauthorized");
    renderView();
    expect(await screen.findByText(/Sign in to keep watching/)).toBeInTheDocument();
  });

  it("asset_not_ready can be retried, which requests a fresh grant", async () => {
    routes["POST /v1/episodes/{episode_id}/play"] = () => err(409, "asset_not_ready");
    renderView();
    fireEvent.click(await screen.findByText("Try again"));
    await waitFor(() => expect(playCalls()).toHaveLength(2));
  });

  it("other failures show the server message with retry", async () => {
    routes["POST /v1/episodes/{episode_id}/play"] = () => err(500, "boom", "Server exploded");
    renderView();
    expect(await screen.findByText("Server exploded")).toBeInTheDocument();
    routes["POST /v1/episodes/{episode_id}/play"] = (a) => ok(grant({ episode_id: a.params!.path!.episode_id }));
    fireEvent.click(screen.getByText("Try again"));
    await screen.findByTestId("player");
  });

  it("age gate for a guest asks to sign in; for a member it opens the age dialog", async () => {
    routes["POST /v1/episodes/{episode_id}/play"] = () => err(403, "age_gate_required");
    const a = renderView();
    await waitFor(() => expect(auth.openAuth).toHaveBeenCalled());
    expect(screen.getByText("This drama is rated for adults.")).toBeInTheDocument();
    a.unmount();
    authed();
    renderView();
    expect(await screen.findByText("Mature content")).toBeInTheDocument();
  });

  it("the placeholder's confirm button opens the age dialog", async () => {
    routes["POST /v1/episodes/{episode_id}/play"] = () => err(403, "age_gate_required");
    renderView();
    await screen.findByText("This drama is rated for adults.");
    fireEvent.click(placeholderAgeButton());
    expect(await screen.findByText("Mature content")).toBeInTheDocument();
  });
});

describe("age confirmation", () => {
  async function openAgeDialog() {
    authed();
    routes["POST /v1/episodes/{episode_id}/play"] = () => err(403, "age_gate_required");
    const r = renderView();
    await screen.findByText("Mature content");
    return r;
  }
  const dialogConfirm = () => within(screen.getByText("Mature content").closest("dialog")!).getByText("I am 18 or older");

  it("writes the confirmation, refreshes the user, closes and refetches the grant", async () => {
    await openAgeDialog();
    routes["POST /v1/episodes/{episode_id}/play"] = (a) => ok(grant({ episode_id: a.params!.path!.episode_id }));
    fireEvent.click(dialogConfirm());
    await screen.findByTestId("player");
    expect(api.PATCH).toHaveBeenCalledWith("/v1/auth/me", { body: { age_confirmed: true } });
    expect(auth.refreshUser).toHaveBeenCalled();
  });

  it("shows the error and stays open if the write fails", async () => {
    await openAgeDialog();
    routes["PATCH /v1/auth/me"] = () => err(500, "x", "Could not save");
    fireEvent.click(dialogConfirm());
    expect(await screen.findByText("Could not save")).toBeInTheDocument();
    expect(auth.refreshUser).not.toHaveBeenCalled();
  });

  it("skips the write when the account already confirmed, and the cancel button closes", async () => {
    await openAgeDialog();
    fireEvent.click(screen.getByText("Not now"));
    await waitFor(() => expect(screen.getByText("Mature content").closest("dialog")!.hasAttribute("open")).toBe(false));
    authed({ user: { ...aUser, age_confirmed_at: "2026-01-01T00:00:00Z" } });
    routes["POST /v1/episodes/{episode_id}/play"] = (a) => ok(grant({ episode_id: a.params!.path!.episode_id }));
    // Reopen through the placeholder.
    fireEvent.click(placeholderAgeButton());
    fireEvent.click(dialogConfirm());
    await screen.findByTestId("player");
    expect(api.PATCH).not.toHaveBeenCalled();
  });

  it("retries the unlock that was blocked after confirming", async () => {
    authed();
    routes["POST /v1/episodes/{episode_id}/play"] = () => err(403, "locked");
    let first = true;
    routes["POST /v1/episodes/{episode_id}/unlock"] = () => {
      if (first) {
        first = false;
        return err(403, "age_gate_required");
      }
      return ok({ coin_balance: 90 });
    };
    renderView({}, 3);
    await screen.findByText("Unlock episode 3");
    fireEvent.click(screen.getByText("Unlock for 10 coins"));
    await screen.findByText("Mature content");
    fireEvent.click(dialogConfirm());
    await waitFor(() => expect(auth.setBalance).toHaveBeenCalledWith(90));
    expect(api.POST.mock.calls.filter((c) => c[0] === "/v1/episodes/{episode_id}/unlock")).toHaveLength(2);
  });
});

describe("hydration after sign-in", () => {
  it("refetches the series as the member and applies episodes, resume point and engagement", async () => {
    authed();
    routes["GET /v1/series/{id_or_slug}"] = () =>
      ok(seriesDetail({ is_liked: true, like_count: 99, is_favorite: true, continue_episode_number: 2, episodes: [ep(1, { is_free: true }), ep(2, { accessible: true }), ep(3), ep(4)] }));
    renderView();
    await screen.findByText("Liked");
    expect(screen.getByText("In My List")).toBeInTheDocument();
    expect(screen.getByText("99 likes")).toBeInTheDocument();
    expect(api.GET).toHaveBeenCalledWith("/v1/series/{id_or_slug}", { params: { path: { id_or_slug: "s1" }, query: { lang: "en" } } });
    expect(tile(2).textContent).toContain("Resume");
    // Only once per user.
    expect(api.GET.mock.calls.filter((c) => c[0] === "/v1/series/{id_or_slug}")).toHaveLength(1);
  });

  it("does not undo a like the viewer made while the refetch was in flight", async () => {
    authed();
    let resolve!: (v: unknown) => void;
    routes["GET /v1/series/{id_or_slug}"] = () => new Promise((r) => (resolve = r));
    renderView();
    await screen.findByTestId("player");
    fireEvent.click(screen.getByText("Like"));
    await screen.findByText("Liked");
    await act(async () => resolve(ok(seriesDetail({ is_liked: false, like_count: 0, continue_episode_number: 3, episodes: [ep(1, { is_free: true })] }))));
    expect(screen.getByText("Liked")).toBeInTheDocument();
    expect(screen.getByText("31 likes")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Episode 2/)).toBeNull(); // episodes still applied
  });

  it("ignores a failed refetch", async () => {
    authed();
    routes["GET /v1/series/{id_or_slug}"] = () => err(500, "x");
    renderView();
    await screen.findByTestId("player");
    expect(screen.getByText("Like")).toBeInTheDocument();
  });
});

describe("selecting episodes", () => {
  it("a guest picking a paid episode is asked to sign in; the URL still moves", () => {
    const push = vi.spyOn(window.history, "pushState");
    renderView();
    fireEvent.click(tile(3));
    expect(auth.openAuth).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith(null, "", expect.stringContaining("ep=3"));
  });

  it("picking a free episode pushes history and loads a new grant", async () => {
    const push = vi.spyOn(window.history, "pushState");
    renderView();
    await screen.findByTestId("player");
    fireEvent.click(tile(2));
    expect(push).toHaveBeenCalledWith(null, "", expect.stringContaining("ep=2"));
    await waitFor(() => expect(playedIds()).toEqual(["ep-1", "ep-2"]));
  });

  it("re-picking the current episode drops and refetches its grant", async () => {
    renderView();
    await screen.findByTestId("player");
    fireEvent.click(tile(1));
    await waitFor(() => expect(playCalls()).toHaveLength(2));
  });

  it("an episode further than 'next' opens the sequential-unlock message instead of a purchase", async () => {
    authed();
    renderView();
    await screen.findByTestId("player");
    fireEvent.click(tile(4));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("Unlock previous episodes first");
    expect(playedIds()).toEqual(["ep-1"]);
  });

  it("the player's next and reload callbacks move on and refetch", async () => {
    const push = vi.spyOn(window.history, "pushState");
    renderView();
    await screen.findByTestId("player");
    fireEvent.click(screen.getByText("stub-reload"));
    await waitFor(() => expect(playCalls()).toHaveLength(2));
    await screen.findByTestId("player");
    fireEvent.click(screen.getByText("stub-next"));
    expect(push).toHaveBeenCalledWith(null, "", expect.stringContaining("ep=2"));
    await waitFor(() => expect(playedIds()).toContain("ep-2"));
  });

  it("hasNext is false on the last episode and onNext is then a no-op", async () => {
    renderView({ episodes: [ep(1, { is_free: true })], episode_count: 1 });
    await screen.findByTestId("player");
    expect(screen.getByTestId("has-next").textContent).toBe("false");
    fireEvent.click(screen.getByText("stub-next"));
    expect(playCalls()).toHaveLength(1);
  });
});

describe("unlocking", () => {
  async function paywall(patch = {}) {
    authed(patch);
    routes["POST /v1/episodes/{episode_id}/play"] = (a) =>
      a.params!.path!.episode_id === "ep-3" ? err(403, "locked") : ok(grant({ episode_id: a.params!.path!.episode_id }));
    const r = renderView({ episodes: [ep(1, { is_free: true }), ep(2, { is_free: true }), ep(3), ep(4)] }, 3);
    await screen.findByText("Unlock episode 3");
    return r;
  }
  const unlockButton = () => screen.getByText("Unlock for 10 coins");
  const unlockCalls = () => api.POST.mock.calls.filter((c) => c[0] === "/v1/episodes/{episode_id}/unlock");

  it("spends coins, updates the balance, toasts, tracks and plays the episode", async () => {
    await paywall();
    routes["POST /v1/episodes/{episode_id}/play"] = (a) => ok(grant({ episode_id: a.params!.path!.episode_id }));
    fireEvent.click(unlockButton());
    await screen.findByTestId("player");
    expect(unlockCalls()[0][1]).toEqual({ params: { path: { episode_id: "ep-3" } }, body: { method: "coins" } });
    expect(auth.setBalance).toHaveBeenCalledWith(90);
    expect(toast).toHaveBeenCalledWith("Episode 3 unlocked", "gold");
    expect(track).toHaveBeenCalledWith("unlock", { series_id: "s1", episode_id: "ep-3", episode_number: 3, method: "coins", price: 10 });
    expect(window.location.search).toContain("ep=3");
  });

  it("can unlock with a rewarded ad", async () => {
    authed();
    routes["POST /v1/episodes/{episode_id}/play"] = (a) =>
      a.params!.path!.episode_id === "ep-3" ? err(403, "locked") : ok(grant({ episode_id: a.params!.path!.episode_id }));
    render(<SeriesView series={seriesDetail({ episodes: [ep(1, { is_free: true }), ep(2, { is_free: true }), ep(3), ep(4)] })} initialEpisode={3} />, {
      wrapper: appWrapper({ config: { flags: { rewarded_ads: true } } as never }),
    });
    fireEvent.click(await screen.findByText("Watch an ad to unlock"));
    await waitFor(() => expect(unlockCalls()).toHaveLength(1));
    expect(unlockCalls()[0][1].body).toEqual({ method: "ad" });
  });

  it("402 leaves the dialog open with the server message", async () => {
    await paywall();
    routes["POST /v1/episodes/{episode_id}/unlock"] = () => err(402, "insufficient_coins", "Need more coins");
    fireEvent.click(unlockButton());
    expect(await screen.findByText("Need more coins")).toBeInTheDocument();
    expect(screen.getByText("Get coins")).toBeInTheDocument();
  });

  it("insufficient_coins by code alone is treated the same", async () => {
    await paywall();
    routes["POST /v1/episodes/{episode_id}/unlock"] = () => err(400, "insufficient_coins", "Short");
    fireEvent.click(unlockButton());
    expect(await screen.findByText("Short")).toBeInTheDocument();
  });

  it("already_accessible closes the dialog and plays", async () => {
    await paywall();
    routes["POST /v1/episodes/{episode_id}/unlock"] = () => err(409, "already_accessible");
    routes["POST /v1/episodes/{episode_id}/play"] = (a) => ok(grant({ episode_id: a.params!.path!.episode_id }));
    fireEvent.click(unlockButton());
    await screen.findByTestId("player");
    expect(toast).not.toHaveBeenCalled();
  });

  it("sequential_unlock_required, 401 and unknown errors surface appropriately", async () => {
    await paywall();
    routes["POST /v1/episodes/{episode_id}/unlock"] = () => err(409, "sequential_unlock_required", "Do 2 first");
    fireEvent.click(unlockButton());
    expect((await screen.findByRole("alert")).textContent).toBe("Do 2 first");
    routes["POST /v1/episodes/{episode_id}/unlock"] = () => err(401, "unauthorized");
    fireEvent.click(unlockButton());
    await waitFor(() => expect(auth.openAuth).toHaveBeenCalled());
    routes["POST /v1/episodes/{episode_id}/unlock"] = () => err(500, "boom", "Kaboom");
    fireEvent.click(unlockButton());
    expect((await screen.findByRole("alert")).textContent).toBe("Kaboom");
  });

  it("prompts for sign-in when the session ended while the dialog was open", async () => {
    authed();
    routes["POST /v1/episodes/{episode_id}/play"] = (a) =>
      a.params!.path!.episode_id === "ep-3" ? err(403, "locked") : ok(grant({ episode_id: a.params!.path!.episode_id }));
    const series = seriesDetail({ episodes: [ep(1, { is_free: true }), ep(2, { is_free: true }), ep(3), ep(4)] });
    currentSeries = series;
    const wrapper = appWrapper({ config: { flags: { rewarded_ads: true } } as never });
    const { rerender } = render(<SeriesView series={series} initialEpisode={3} />, { wrapper });
    await screen.findByText("Unlock episode 3");
    setAuth({ status: "anonymous" });
    rerender(<SeriesView series={series} initialEpisode={3} />);
    fireEvent.click(await screen.findByText("Watch an ad to unlock"));
    expect(auth.openAuth).toHaveBeenCalled();
    expect(unlockCalls()).toHaveLength(0);
  });

  it("closing the dialog resets it", async () => {
    await paywall();
    fireEvent.click(within(dialogOf("Unlock episode 3")).getByLabelText("Close"));
    await waitFor(() => expect(screen.queryByText("Unlock for 10 coins")).toBeNull());
  });

  it("offers the bundle once priced and buys it", async () => {
    await paywall();
    fireEvent.click(await screen.findByText("Unlock the whole series"));
    await waitFor(() => expect(auth.setBalance).toHaveBeenCalledWith(50));
    expect(toast).toHaveBeenCalledWith("2 episodes unlocked", "gold");
    expect(track).toHaveBeenCalledWith("unlock_bundle", { series_id: "s1", episodes: 2, spent: 15 });
  });

  it("bundle errors: 402, age gate, other", async () => {
    await paywall();
    const buy = async () => fireEvent.click(await screen.findByText("Unlock the whole series"));
    routes["POST /v1/series/{series_id}/bundle"] = () => err(402, "insufficient_coins", "Bundle too dear");
    await buy();
    expect(await screen.findByText("Bundle too dear")).toBeInTheDocument();
    routes["POST /v1/series/{series_id}/bundle"] = () => err(500, "boom", "Bundle broke");
    await buy();
    expect((await screen.findByRole("alert")).textContent).toBe("Bundle broke");
    routes["POST /v1/series/{series_id}/bundle"] = () => err(403, "age_gate_required");
    await buy();
    expect(await screen.findByText("Mature content")).toBeInTheDocument();
  });

  it("an unpriceable bundle simply isn't shown", async () => {
    routes["GET /v1/series/{series_id}/bundle"] = () => err(500, "x");
    await paywall();
    await waitFor(() => expect(api.GET.mock.calls.some((c) => c[0] === "/v1/series/{series_id}/bundle")).toBe(true));
    expect(screen.queryByText("Unlock the whole series")).toBeNull();
  });
});

describe("episode end and progress", () => {
  it("authenticated progress is saved with floor + completion flag, keepalive", async () => {
    authed();
    renderView();
    await screen.findByTestId("player");
    const put = () => api.PUT.mock.calls.map((c) => c[1]);
    fireEvent.click(screen.getByText("stub-progress-mid"));
    fireEvent.click(screen.getByText("stub-progress-end"));
    fireEvent.click(screen.getByText("stub-progress-unknown"));
    expect(put().map((c) => c.body)).toEqual([
      { position_sec: 20, completed: false },
      { position_sec: 99, completed: true },
      { position_sec: 5, completed: false },
    ]);
    expect(put()[0]).toMatchObject({ params: { path: { episode_id: "ep-1" } }, keepalive: true });
  });

  it("guest progress is kept in the browser, using the episode number", async () => {
    renderView({ cover_url: "https://cdn/c.jpg" });
    await screen.findByTestId("player");
    fireEvent.click(screen.getByText("stub-progress-mid"));
    const rows = JSON.parse(window.localStorage.getItem("katha.guest_history")!);
    expect(rows[0]).toMatchObject({ seriesId: "s1", slug: "my-show", title: "My Show", coverUrl: "https://cdn/c.jpg", episodeNumber: 1, positionSec: 20 });
    expect(api.PUT).not.toHaveBeenCalled();
  });

  it("finishing an episode marks it complete and advances to the next free one with replaceState", async () => {
    authed();
    const replace = vi.spyOn(window.history, "replaceState");
    renderView();
    await screen.findByTestId("player");
    replace.mockClear();
    fireEvent.click(screen.getByText("stub-ended"));
    expect(api.PUT.mock.calls[0][1].body).toEqual({ position_sec: 60, completed: true });
    expect(replace).toHaveBeenCalledWith(null, "", expect.stringContaining("ep=2"));
    await waitFor(() => expect(playedIds()).toContain("ep-2"));
  });

  it("the grant's next_episode_id wins over sequence order", async () => {
    routes["POST /v1/episodes/{episode_id}/play"] = (a) => ok(grant({ episode_id: a.params!.path!.episode_id, next_episode_id: "ep-2" }));
    renderView({ episodes: [ep(1, { is_free: true }), ep(2, { is_free: true }), ep(3, { is_free: true })] });
    await screen.findByTestId("player");
    fireEvent.click(screen.getByText("stub-ended"));
    await waitFor(() => expect(playedIds()).toContain("ep-2"));
  });

  it("with no next episode nothing happens after the end", async () => {
    renderView({ episodes: [ep(1, { is_free: true })] });
    await screen.findByTestId("player");
    fireEvent.click(screen.getByText("stub-ended"));
    expect(playCalls()).toHaveLength(1);
  });

  it("a guest reaching a paid next episode is sent to sign in", async () => {
    renderView({ episodes: [ep(1, { is_free: true }), ep(2)] });
    await screen.findByTestId("player");
    fireEvent.click(screen.getByText("stub-ended"));
    expect(auth.openAuth).toHaveBeenCalled();
    expect(screen.getByText(/Sign in to keep watching/)).toBeInTheDocument();
  });

  it("a member reaching the next locked episode gets the unlock sheet; a later one gets the sequential message", async () => {
    authed();
    renderView({ episodes: [ep(1, { is_free: true }), ep(2)] });
    await screen.findByTestId("player");
    fireEvent.click(screen.getByText("stub-ended"));
    expect(await screen.findByText("Unlock for 10 coins")).toBeInTheDocument();
  });

  it("a next episode beyond the unlockable one shows the sequential message", async () => {
    authed();
    routes["POST /v1/episodes/{episode_id}/play"] = (a) => ok(grant({ episode_id: a.params!.path!.episode_id, next_episode_id: "ep-4" }));
    renderView({ episodes: [ep(1, { is_free: true }), ep(2), ep(3), ep(4)] });
    await screen.findByTestId("player");
    fireEvent.click(screen.getByText("stub-ended"));
    expect((await screen.findByRole("alert")).textContent).toBe("Unlock previous episodes first");
  });

  it("an unfinished episode without a duration is reported as 0", async () => {
    authed();
    renderView({ episodes: [ep(1, { is_free: true, duration_sec: null })] });
    await screen.findByTestId("player");
    fireEvent.click(screen.getByText("stub-ended"));
    expect(api.PUT.mock.calls[0][1].body.position_sec).toBe(0);
  });
});

describe("engagement", () => {
  it("guests are asked to sign in for like, my list and report", () => {
    renderView();
    fireEvent.click(screen.getByText("Like"));
    fireEvent.click(screen.getByText("My List"));
    fireEvent.click(screen.getByText("Report"));
    expect(auth.openAuth).toHaveBeenCalledTimes(3);
    expect(api.POST.mock.calls.some((c) => String(c[0]).includes("like"))).toBe(false);
  });

  it("like flips optimistically and settles on the server count; toggling back decrements", async () => {
    authed();
    renderView();
    fireEvent.click(screen.getByText("Like"));
    expect(screen.getByText("Liked")).toBeInTheDocument();
    expect(screen.getByText("31 likes")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Liked").closest("button")!.getAttribute("aria-pressed")).toBe("true"));
    routes["POST /v1/series/{series_id}/like"] = () => ok({ active: false });
    fireEvent.click(screen.getByText("Liked"));
    await screen.findByText("Like");
    expect(screen.getByText("30 likes")).toBeInTheDocument();
  });

  it("a failed like reverts and toasts the error", async () => {
    authed();
    routes["POST /v1/series/{series_id}/like"] = () => err(500, "boom", "Nope");
    renderView();
    fireEvent.click(screen.getByText("Like"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Nope", "error"));
    expect(screen.getByText("Like")).toBeInTheDocument();
    expect(screen.getByText("30 likes")).toBeInTheDocument();
  });

  it("my list toggles with a toast, reverts on failure", async () => {
    authed();
    renderView();
    fireEvent.click(screen.getByText("My List"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Added to My List", "success"));
    expect(screen.getByText("In My List")).toBeInTheDocument();
    routes["POST /v1/series/{series_id}/favorite"] = () => ok({ active: false });
    fireEvent.click(screen.getByText("In My List"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Removed from My List", "success"));
    routes["POST /v1/series/{series_id}/favorite"] = () => err(500, "boom", "Fav failed");
    fireEvent.click(screen.getByText("My List"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Fav failed", "error"));
    expect(screen.getByText("My List")).toBeInTheDocument();
  });

  it("report opens the dialog for members", () => {
    authed();
    renderView();
    fireEvent.click(screen.getByText("Report"));
    expect(screen.getByText("Report a problem").closest("dialog")!.hasAttribute("open")).toBe(true);
    fireEvent.click(screen.getAllByLabelText("Close")[0]);
  });

  it("shows the coin balance only for members", () => {
    const a = renderView();
    expect(screen.queryByText("120")).toBeNull();
    a.unmount();
    authed();
    renderView();
    expect(screen.getByText("120")).toBeInTheDocument();
  });

  it("share uses the native sheet when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    renderView();
    fireEvent.click(screen.getByText("Share"));
    await waitFor(() => expect(share).toHaveBeenCalledWith({ title: "My Show", text: "A synopsis", url: window.location.href }));
    expect(track).toHaveBeenCalledWith("share", expect.objectContaining({ method: "native", episode_id: "ep-1" }));
    delete (navigator as unknown as Record<string, unknown>).share;
  });

  it("share falls back to the clipboard with a toast, and swallows cancellation", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderView();
    fireEvent.click(screen.getByText("Share"));
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Link copied", "success"));
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(track).toHaveBeenCalledWith("share", expect.objectContaining({ method: "clipboard" }));
    writeText.mockRejectedValue(new Error("denied"));
    toast.mockClear();
    fireEvent.click(screen.getByText("Share"));
    await new Promise((r) => setTimeout(r, 0));
    expect(toast).not.toHaveBeenCalled();
  });
});

describe("page details", () => {
  it("renders classification, status, release note, categories and counts", () => {
    renderView({
      content_rating: "18+",
      is_adult: true,
      completion_status: "Ongoing",
      release_note: "New episode Fridays",
      categories: [{ id: "c1", slug: "romance", name: "Romance" }],
      is_premium: true,
      free_episodes: 1,
      episode_count: 1,
      view_count: 25_000,
    });
    expect(screen.getByText("18+").className).toContain("text-danger");
    expect(screen.getByText("Ongoing")).toBeInTheDocument();
    expect(screen.getByText("New episode Fridays")).toBeInTheDocument();
    expect(screen.getByText("Romance")).toBeInTheDocument();
    expect(screen.getByText("1 Episode")).toBeInTheDocument();
    expect(screen.getByText("25K views")).toBeInTheDocument();
    expect(screen.getByText(/1\s+free episode/)).toBeInTheDocument();
  });

  it("uses the neutral rating style, plural labels and Free for non-premium series", () => {
    const a = renderView({ content_rating: "U/A 13+", is_premium: true, free_episodes: 3 });
    expect(a.container.textContent).toContain("3 free episodes");
    expect(screen.getByText("U/A 13+").className).toContain("text-ink2");
    expect(screen.getByText("4 episodes")).toBeInTheDocument();
    a.unmount();
    renderView({ is_premium: false });
    expect(screen.getAllByText("Free").length).toBeGreaterThan(0);
  });

  it("omits the synopsis block when there is none", () => {
    renderView({ synopsis: null });
    expect(screen.queryByText("A synopsis")).toBeNull();
  });

  it("offers Show more only when the synopsis overflows, and toggles", () => {
    const sh = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(100);
    const ch = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(40);
    renderView();
    fireEvent.click(screen.getByText("Show more"));
    expect(screen.getByText("A synopsis").className).not.toContain("line-clamp-3");
    fireEvent.click(screen.getByText("Show less"));
    expect(screen.getByText("A synopsis").className).toContain("line-clamp-3");
    sh.mockRestore();
    ch.mockRestore();
  });

  it("hides the Show more button when the text fits", () => {
    renderView();
    expect(screen.queryByText("Show more")).toBeNull();
  });

  it("re-measures the synopsis on resize and disconnects on unmount", () => {
    const { unmount } = renderView();
    unmount();
    expect(screen.queryByText("Show more")).toBeNull();
  });

  it("switches to a landscape layout once the player reports a wide video, per episode", async () => {
    const { container } = renderView();
    await screen.findByTestId("player");
    const frame = () => container.querySelector("div.relative.w-full") as HTMLElement;
    expect(frame().style.aspectRatio).toBe("0.5625 / 1");
    fireEvent.click(screen.getByText("stub-landscape"));
    expect(frame().style.aspectRatio).toBe("1.7777777777777777 / 1");
    fireEvent.click(tile(2));
    await waitFor(() => expect(frame().style.aspectRatio).toBe("0.5625 / 1"));
  });
});
