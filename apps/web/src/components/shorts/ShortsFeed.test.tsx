import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";
import { aUser, auth, setAuth } from "@/test-utils/auth-context";
import { ShortsFeed } from "./ShortsFeed";

vi.mock("next/navigation", () => import("@/test-utils/next-navigation"));
vi.mock("@/lib/auth-context", () => import("@/test-utils/auth-context"));
const GET = vi.fn();
const POST = vi.fn();
const PATCH = vi.fn();
vi.mock("@/lib/client-api", () => ({
  clientApi: { GET: (...a: unknown[]) => GET(...a), POST: (...a: unknown[]) => POST(...a), PATCH: (...a: unknown[]) => PATCH(...a) },
}));
const track = vi.fn();
vi.mock("@/lib/analytics", () => ({ track: (...a: unknown[]) => track(...a) }));
const toast = vi.fn();
vi.mock("@/lib/toast", () => ({ useToast: () => toast }));

// The HLS engine is the boundary: capture the options the feed hands it and let tests drive them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;
const hls = { opts: null as null | Loose, error: null as string | null, calls: [] as Loose[] };
vi.mock("../player/use-hls", () => ({
  useHls: (_ref: unknown, opts: Loose) => {
    hls.opts = opts;
    hls.calls.push(opts);
    return { error: hls.error };
  },
}));
const beacons = { start: vi.fn(), playing: vi.fn(), waiting: vi.fn(), complete: vi.fn(), error: vi.fn(), levelSwitch: vi.fn() };
const beaconTargets: unknown[] = [];
vi.mock("../player/beacons", () => ({
  PlaybackBeacons: class {
    constructor(target: unknown) {
      beaconTargets.push(target);
    }
    start = beacons.start;
    playing = beacons.playing;
    waiting = beacons.waiting;
    complete = beacons.complete;
    error = beacons.error;
    levelSwitch = beacons.levelSwitch;
  },
}));

HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  this.removeAttribute("open");
};

// IntersectionObserver stand-in.
class IO {
  static instances: IO[] = [];
  observed = new Set<Element>();
  disconnected = false;
  constructor(
    public cb: (entries: unknown[]) => void,
    public options?: { root?: Element | null },
  ) {
    IO.instances.push(this);
  }
  unobserve(el: Element) {
    this.observed.delete(el);
  }
  observe(el: Element) {
    this.observed.add(el);
  }
  disconnect() {
    this.disconnected = true;
  }
  /** The feed's own observer (next/link creates root-less ones for prefetching). */
  static last() {
    return IO.instances.filter((i) => i.options?.root).at(-1)!;
  }
}
const scrollIntoView = vi.fn();

const ok = (data: unknown) => ({ data, response: { ok: true, status: 200 } });
const fail = (status: number, code = "e", message = "bad") => ({ error: { detail: { code, message } }, response: { ok: false, status } });

const item = (n: number, over: Record<string, unknown> = {}) => ({
  episode_id: `e${n}`,
  series_id: `s${n}`,
  slug: `show-${n}`,
  title: `Show ${n}`,
  synopsis: `Synopsis ${n}`,
  episode_number: 1,
  episode_count: 20,
  price: 15,
  thumbnail_url: `/t${n}.jpg`,
  cover_url: `/c${n}.jpg`,
  categories: [{ name: "Romance" }],
  is_liked: false,
  is_favorite: false,
  ...over,
});
const grant = { hls_url: "https://cdn/x.m3u8", expires_at: "2030-01-01T00:00:00Z" };

type Props = Partial<React.ComponentProps<typeof ShortsFeed>>;
function mount(props: Props = {}, lang = "en") {
  const p = { initial: [item(1), item(2), item(3)] as never, nextCursor: null, lang, ...props };
  return render(<ShortsFeed {...p} />, { wrapper: appWrapper({ lang }) });
}
const section = (n: number) => document.querySelector(`[data-episode-id="e${n}"]`) as HTMLElement;
const entry = (n: number, ratio: number, isIntersecting = true) => ({ target: section(n), intersectionRatio: ratio, isIntersecting });
const scrollTo = (...entries: unknown[]) => act(() => IO.last().cb(entries));

beforeEach(() => {
  [GET, POST, PATCH].forEach((m) => m.mockReset());
  [track, toast, ...Object.values(beacons)].forEach((m) => m.mockReset());
  beaconTargets.length = 0;
  hls.opts = null;
  hls.error = null;
  hls.calls.length = 0;
  IO.instances = [];
  vi.stubGlobal("IntersectionObserver", IO);
  Element.prototype.scrollIntoView = scrollIntoView;
  scrollIntoView.mockReset();
  setAuth({ status: "anonymous", user: null });
  POST.mockImplementation(async (path: string) => (path === "/v1/episodes/{episode_id}/play" ? ok(grant) : ok({ active: true })));
  GET.mockResolvedValue(ok({ items: [], next_cursor: null }));
  window.history.replaceState(null, "", "/shorts");
});
afterEach(() => vi.unstubAllGlobals());

describe("rendering", () => {
  it("renders nothing when there are no items", () => {
    const { container } = mount({ initial: [] });
    expect(container.innerHTML).toBe("");
  });

  it("renders every short with metadata, a swipe hint on the first only, and links", async () => {
    mount();
    await waitFor(() => expect(POST).toHaveBeenCalled());
    expect(screen.getAllByRole("region").length).toBe(3);
    expect(screen.getByLabelText("Show 1 - Episode 1 of 20")).toBeInTheDocument();
    expect(screen.getAllByText("Swipe up for the next episode")).toHaveLength(1);
    expect(screen.getAllByText("Romance")).toHaveLength(3);
    expect(screen.getByText("Synopsis 2")).toBeInTheDocument();
    expect(screen.getByText("Show 2").closest("a")!.getAttribute("href")).toBe("/series/show-2");
    expect(screen.getAllByText("Watch full")[1].closest("a")!.getAttribute("href")).toBe("/series/show-2?ep=1");
    expect(screen.getByLabelText("Shorts")).toBeInTheDocument();
  });

  it("copes with items lacking synopsis, genre and artwork", async () => {
    mount({ initial: [item(1, { synopsis: null, categories: [], thumbnail_url: null, cover_url: null })] as never });
    await waitFor(() => expect(POST).toHaveBeenCalled());
    expect(document.querySelector("img")).toBeNull();
    expect(screen.queryByText("Romance")).toBeNull();
  });

  it("falls back to the cover when there is no thumbnail", async () => {
    mount({ initial: [item(1, { thumbnail_url: null })] as never });
    await waitFor(() => expect(POST).toHaveBeenCalled());
    expect(document.querySelector("img")!.getAttribute("src")).toContain("c1.jpg");
  });

  it("uses the language prefix for links", async () => {
    mount({}, "hi");
    await waitFor(() => expect(POST).toHaveBeenCalled());
    expect(screen.getByText("Show 1").closest("a")!.getAttribute("href")).toBe("/hi/series/show-1");
  });

  it("only the active (first) short asks for a playback grant and renders a video", async () => {
    mount();
    await waitFor(() => expect(document.querySelector("video")).not.toBeNull());
    expect(POST).toHaveBeenCalledTimes(1);
    expect(POST).toHaveBeenCalledWith("/v1/episodes/{episode_id}/play", { params: { path: { episode_id: "e1" } } });
    expect(document.querySelectorAll("video")).toHaveLength(1);
    expect(hls.opts!.src).toBe(grant.hls_url);
    expect(beaconTargets[0]).toEqual({ episodeId: "e1", seriesId: "s1", surface: "shorts" });
  });

  it("opens at the requested short and scrolls it into view once", async () => {
    mount({ startAt: { slug: "show-2", episode: 1 } });
    await waitFor(() => expect(POST).toHaveBeenCalledWith("/v1/episodes/{episode_id}/play", { params: { path: { episode_id: "e2" } } }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  });

  it("ignores a startAt that matches nothing", async () => {
    mount({ startAt: { slug: "nope", episode: 9 } });
    await waitFor(() => expect(POST).toHaveBeenCalledWith("/v1/episodes/{episode_id}/play", { params: { path: { episode_id: "e1" } } }));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe("scrolling", () => {
  it("observes every item and disconnects on unmount", () => {
    const { unmount } = mount();
    expect(IO.last().observed.size).toBe(3);
    unmount();
    expect(IO.instances.filter((i) => i.options?.root).every((i) => i.disconnected)).toBe(true);
  });

  it("activates the most visible item, tracks the swipe and updates the URL", async () => {
    mount();
    await waitFor(() => expect(POST).toHaveBeenCalledTimes(1));
    await scrollTo(entry(1, 0.3), entry(2, 0.9), entry(3, 0.7), entry(1, 0.1, false));
    await waitFor(() => expect(POST).toHaveBeenCalledWith("/v1/episodes/{episode_id}/play", { params: { path: { episode_id: "e2" } } }));
    expect(track).toHaveBeenCalledWith("shorts_swipe", { position: 1, series_id: "s2", episode_number: 1 });
    expect(window.location.search).toBe("?s=show-2&ep=1");
    expect(document.querySelectorAll("video")).toHaveLength(1);
  });

  it("ignores weakly visible, non-intersecting and id-less entries", async () => {
    mount();
    await waitFor(() => expect(POST).toHaveBeenCalledTimes(1));
    await scrollTo(entry(2, 0.5), entry(3, 0.9, false), { target: document.createElement("div"), intersectionRatio: 1, isIntersecting: true });
    expect(track).not.toHaveBeenCalled();
    await scrollTo();
    expect(track).not.toHaveBeenCalled();
  });

  it("ignores an entry for an item it no longer holds", async () => {
    mount();
    const ghost = document.createElement("div");
    ghost.dataset.episodeId = "gone";
    await scrollTo({ target: ghost, intersectionRatio: 1, isIntersecting: true });
    expect(track).not.toHaveBeenCalled();
  });

  it("prefetches the next page near the end, appends without duplicates, and stops when the cursor ends", async () => {
    GET.mockResolvedValueOnce(ok({ items: [item(3), item(4), item(5)], next_cursor: null }));
    mount({ nextCursor: "c1" });
    await waitFor(() => expect(POST).toHaveBeenCalledTimes(1));
    await scrollTo(entry(2, 0.9));
    await waitFor(() => expect(GET).toHaveBeenCalledWith("/v1/shorts", { params: { query: { lang: "en", cursor: "c1" } } }));
    await screen.findByText("Show 5");
    expect(screen.getAllByText("Show 3")).toHaveLength(1);
    // no cursor left: another scroll near the end fetches nothing more
    GET.mockClear();
    await scrollTo(entry(5, 0.9));
    expect(GET).not.toHaveBeenCalled();
  });

  it("does not prefetch with no cursor, nor when the page fetch fails (and can retry later)", async () => {
    GET.mockResolvedValueOnce(fail(500));
    mount({ nextCursor: "c1" });
    await scrollTo(entry(2, 0.9));
    await waitFor(() => expect(GET).toHaveBeenCalledTimes(1));
    GET.mockResolvedValueOnce(ok({ items: [item(9)], next_cursor: "c2" }));
    await scrollTo(entry(3, 0.9));
    await screen.findByText("Show 9");
  });

  it("does not prefetch when far from the end", async () => {
    mount({ initial: Array.from({ length: 8 }, (_, i) => item(i + 1)) as never, nextCursor: "c1" });
    await scrollTo(entry(1, 0.9));
    await scrollTo(entry(2, 0.9));
    expect(GET).not.toHaveBeenCalled();
  });

  it("does not start a second page fetch while one is in flight", async () => {
    let resolve!: (v: unknown) => void;
    GET.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    mount({ nextCursor: "c1" });
    await scrollTo(entry(2, 0.9));
    await scrollTo(entry(3, 0.9));
    expect(GET).toHaveBeenCalledTimes(1);
    await act(async () => resolve(ok({ items: [], next_cursor: null })));
  });
});

describe("playback states", () => {
  const failPlay = (status: number, code = "e", message = "bad") =>
    POST.mockImplementation(async (p: string) => (p === "/v1/episodes/{episode_id}/play" ? fail(status, code, message) : ok({ active: true })));

  it("shows a spinner while the grant loads", () => {
    POST.mockReturnValue(new Promise(() => {}));
    mount();
    expect(document.querySelector("svg.animate-spin, [class*=animate-spin]")).not.toBeNull();
  });

  it("asks guests to sign in on 401", async () => {
    failPlay(401);
    mount();
    fireEvent.click(await screen.findByText("Sign in", { selector: "button" }));
    expect(screen.getByText("Sign in to watch this one.")).toBeInTheDocument();
    expect(auth.openAuth).toHaveBeenCalled();
  });

  it("shows the unlock call-to-action on 403", async () => {
    failPlay(403);
    mount({ initial: [item(1, { episode_number: 4 })] as never });
    expect(await screen.findByText("Unlock episode 4")).toBeInTheDocument();
    expect(screen.getByText("15 coins, unlocked forever")).toBeInTheDocument();
    expect(screen.getByText("Unlock and keep watching").closest("a")!.getAttribute("href")).toBe("/series/show-1?ep=4");
  });

  it("shows the error message and retries", async () => {
    failPlay(500, "boom", "Server on fire");
    mount();
    expect(await screen.findByText("Server on fire")).toBeInTheDocument();
    POST.mockImplementation(async () => ok(grant));
    fireEvent.click(screen.getByText("Try again"));
    await waitFor(() => expect(document.querySelector("video")).not.toBeNull());
  });

  it("shows playback errors from the player with a retry that requests a new grant", async () => {
    hls.error = "Playback stopped. Tap to reload.";
    mount();
    expect(await screen.findByText("Playback stopped. Tap to reload.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Try again"));
    await waitFor(() => expect(POST).toHaveBeenCalledTimes(2));
  });

  it("a grant without an HLS url keeps the spinner", async () => {
    POST.mockImplementation(async () => ok({ hls_url: null }));
    mount();
    await waitFor(() => expect(POST).toHaveBeenCalled());
    expect(document.querySelector("video")).toBeNull();
  });

  it("wires the player callbacks to beacons and reload", async () => {
    mount();
    await waitFor(() => expect(document.querySelector("video")).not.toBeNull());
    hls.opts!.onLevelSwitch(800, 720);
    hls.opts!.onFatalError("netfail");
    hls.opts!.onSourceAttached();
    expect(beacons.levelSwitch).toHaveBeenCalledWith(800, 720);
    expect(beacons.error).toHaveBeenCalledWith("netfail", true);
    expect(beacons.start).toHaveBeenCalled();
    expect(hls.opts!.labels.unsupported).toMatch(/HLS/);
    expect(hls.opts!.expiresAt).toBe(grant.expires_at);
    await act(async () => hls.opts!.onReload());
    expect(POST).toHaveBeenCalledTimes(2);
  });

  it("forwards video element events to beacons and toggles play/pause on tap", async () => {
    mount();
    await waitFor(() => expect(document.querySelector("video")).not.toBeNull());
    const video = document.querySelector("video")!;
    fireEvent(video, new Event("playing"));
    fireEvent(video, new Event("waiting"));
    fireEvent(video, new Event("ended"));
    fireEvent(video, new Event("error"));
    expect(beacons.playing).toHaveBeenCalled();
    expect(beacons.waiting).toHaveBeenCalled();
    expect(beacons.complete).toHaveBeenCalled();
    expect(beacons.error).toHaveBeenCalledWith("media_0", true);
    const play = vi.spyOn(video, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(video, "pause").mockImplementation(() => {});
    Object.defineProperty(video, "paused", { value: true, configurable: true });
    fireEvent.click(video);
    expect(play).toHaveBeenCalled();
    Object.defineProperty(video, "paused", { value: false, configurable: true });
    fireEvent.click(video);
    expect(pause).toHaveBeenCalled();
  });

  it("swallows a rejected play()", async () => {
    mount();
    await waitFor(() => expect(document.querySelector("video")).not.toBeNull());
    const video = document.querySelector("video")!;
    vi.spyOn(video, "play").mockRejectedValue(new Error("blocked"));
    Object.defineProperty(video, "paused", { value: true, configurable: true });
    fireEvent.click(video);
    await Promise.resolve();
  });

  it("moves the single video element to the newly active short", async () => {
    mount();
    await waitFor(() => expect(section(1).querySelector("video")).not.toBeNull());
    await scrollTo(entry(2, 0.9));
    await waitFor(() => expect(section(2).querySelector("video")).not.toBeNull());
    expect(section(1).querySelector("video")).toBeNull();
    expect(document.querySelectorAll("video")).toHaveLength(1);
  });

  it("toggles mute from the rail", async () => {
    mount();
    await waitFor(() => expect(document.querySelector("video")).not.toBeNull());
    expect(document.querySelector("video")!.muted).toBe(true);
    fireEvent.click(screen.getAllByLabelText("Unmute")[0]);
    expect(screen.getAllByLabelText("Mute").length).toBe(3);
    expect(document.querySelector("video")!.muted).toBe(false);
  });
});

const overlayConfirm = async () => {
  await waitFor(() => expect(Array.from(section(1).querySelectorAll("button")).some((b) => b.textContent === "I am 18 or older" && !b.closest("dialog"))).toBe(true));
  return Array.from(section(1).querySelectorAll("button")).find((b) => b.textContent === "I am 18 or older" && !b.closest("dialog"))!;
};

describe("age gate", () => {
  const ageGated = () => POST.mockImplementation(async (p: string) => (p === "/v1/episodes/{episode_id}/play" ? fail(403, "age_gate_required") : ok({})));

  it("opens sign-in for guests and offers the confirmation dialog", async () => {
    ageGated();
    mount();
    fireEvent.click(await overlayConfirm());
    expect(auth.openAuth).toHaveBeenCalled();
    expect(within(section(1)).getByText("Mature content").closest("dialog")!.hasAttribute("open")).toBe(true);
  });

  it("does not open sign-in when already signed in, confirms the age and retries playback", async () => {
    setAuth({ status: "authenticated", user: aUser });
    ageGated();
    PATCH.mockResolvedValue(ok({}));
    mount();
    const open = await overlayConfirm();
    expect(auth.openAuth).not.toHaveBeenCalled();
    fireEvent.click(open);
    const dlg = within(section(1)).getByText("Mature content").closest("dialog")!;
    POST.mockImplementation(async () => ok(grant));
    await act(async () => void fireEvent.click(within(dlg).getByText("I am 18 or older")));
    expect(PATCH).toHaveBeenCalledWith("/v1/auth/me", { body: { age_confirmed: true } });
    expect(auth.refreshUser).toHaveBeenCalled();
    await waitFor(() => expect(document.querySelector("video")).not.toBeNull());
    expect(dlg.hasAttribute("open")).toBe(false);
  });

  it("skips the PATCH when the account already confirmed", async () => {
    setAuth({ status: "authenticated", user: { ...aUser, age_confirmed_at: "2026-01-01" } as never });
    ageGated();
    mount();
    fireEvent.click(await overlayConfirm());
    const dlg = within(section(1)).getByText("Mature content").closest("dialog")!;
    await act(async () => void fireEvent.click(within(dlg).getByText("I am 18 or older")));
    expect(PATCH).not.toHaveBeenCalled();
  });

  it("shows the error and stays open when confirming fails; Not now closes", async () => {
    setAuth({ status: "authenticated", user: aUser });
    ageGated();
    PATCH.mockResolvedValue(fail(500, "e", "Could not confirm"));
    mount();
    fireEvent.click(await overlayConfirm());
    const dlg = within(section(1)).getByText("Mature content").closest("dialog")!;
    await act(async () => void fireEvent.click(within(dlg).getByText("I am 18 or older")));
    expect(within(dlg).getByRole("alert")).toHaveTextContent("Could not confirm");
    fireEvent.click(within(dlg).getByText("Not now"));
    expect(dlg.hasAttribute("open")).toBe(false);
  });
});

describe("engagement for guests", () => {
  it("shows the anonymous server answer and prompts sign-in on like/save", async () => {
    mount({ initial: [item(1, { is_liked: true, is_favorite: true })] as never });
    await waitFor(() => expect(POST).toHaveBeenCalled());
    expect(screen.getByLabelText("Liked").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("In My List").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByLabelText("Liked"));
    fireEvent.click(screen.getByLabelText("In My List"));
    expect(auth.openAuth).toHaveBeenCalledTimes(2);
    expect(POST).toHaveBeenCalledTimes(1); // only the play grant
  });
});

describe("engagement for signed-in viewers", () => {
  beforeEach(() => setAuth({ status: "authenticated", user: aUser }));

  it("keeps the buttons disabled until the viewer's own state is known, then hydrates from a fresh page", async () => {
    // series is not in the hydrated page, so the active item looks it up itself
    GET.mockImplementation(async (path: string) =>
      path === "/v1/shorts"
        ? ok({ items: [{ series_id: "s2", is_liked: true, is_favorite: false }], next_cursor: null })
        : ok({ is_liked: true, is_favorite: true }),
    );
    mount({ initial: [item(1), item(2)] as never });
    expect(screen.getAllByLabelText("Like")[0]).toBeDisabled();
    await waitFor(() => expect(screen.getAllByLabelText("Liked").length).toBe(2));
    expect(GET).toHaveBeenCalledWith("/v1/shorts", { params: { query: { lang: "en" } } });
    expect(GET).toHaveBeenCalledWith("/v1/series/{id_or_slug}", { params: { path: { id_or_slug: "s1" }, query: { lang: "en" } } });
    // the anonymous flags on the items never leak through as the viewer's own
    expect(screen.getAllByLabelText("In My List").length).toBe(1);
  });

  it("falls back to a per-series lookup when the page hydration fails, once", async () => {
    GET.mockImplementation(async (path: string) => (path === "/v1/shorts" ? fail(500) : ok({ is_liked: false, is_favorite: true })));
    mount({ initial: [item(1)] as never });
    await waitFor(() => expect(screen.getByLabelText("In My List")).toBeEnabled());
    expect(GET.mock.calls.filter((c) => c[0] === "/v1/series/{id_or_slug}")).toHaveLength(1);
  });

  it("tolerates a failed series lookup", async () => {
    GET.mockImplementation(async () => fail(500));
    mount({ initial: [item(1)] as never });
    await waitFor(() => expect(GET).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("Like")).toBeDisabled();
  });

  const hydrated = (liked = false, saved = false) =>
    GET.mockImplementation(async () => ok({ items: [{ series_id: "s1", is_liked: liked, is_favorite: saved }], next_cursor: null }));

  it("toggles like through the API using the server's answer", async () => {
    hydrated();
    POST.mockImplementation(async (p: string) => (p.includes("play") ? ok(grant) : ok({ active: true })));
    mount({ initial: [item(1)] as never });
    const like = await screen.findByLabelText("Like");
    await waitFor(() => expect(like).toBeEnabled());
    await act(async () => void fireEvent.click(like));
    expect(POST).toHaveBeenCalledWith("/v1/series/{series_id}/like", { params: { path: { series_id: "s1" } } });
    expect(screen.getByLabelText("Liked").getAttribute("aria-pressed")).toBe("true");
  });

  it("toggles save with a toast for each direction", async () => {
    hydrated(false, true);
    POST.mockImplementation(async (p: string) => (p.includes("play") ? ok(grant) : ok({ active: false })));
    mount({ initial: [item(1)] as never });
    const saved = await screen.findByLabelText("In My List");
    await act(async () => void fireEvent.click(saved));
    expect(toast).toHaveBeenCalledWith("Removed from My List", "success");
    POST.mockImplementation(async (p: string) => (p.includes("play") ? ok(grant) : ok({ active: true })));
    await act(async () => void fireEvent.click(screen.getByLabelText("My List")));
    expect(toast).toHaveBeenLastCalledWith("Added to My List", "success");
  });

  it("toasts when the toggle fails and leaves the state alone", async () => {
    hydrated(true);
    POST.mockImplementation(async (p: string) => (p.includes("play") ? ok(grant) : fail(500, "e", "no luck")));
    mount({ initial: [item(1)] as never });
    const liked = await screen.findByLabelText("Liked");
    await act(async () => void fireEvent.click(liked));
    expect(toast).toHaveBeenCalledWith("no luck", "error");
    expect(screen.getByLabelText("Liked").getAttribute("aria-pressed")).toBe("true");
  });

  it("an edit made before hydration lands is not overwritten by it", async () => {
    let resolveFirst!: (v: unknown) => void;
    GET.mockImplementation((path: string) =>
      path === "/v1/shorts" ? new Promise((r) => (resolveFirst = r)) : Promise.resolve(ok({ is_liked: false, is_favorite: false })),
    );
    POST.mockImplementation(async (p: string) => (p.includes("play") ? ok(grant) : ok({ active: true })));
    mount({ initial: [item(1)] as never });
    const like = await screen.findByLabelText("Like");
    await waitFor(() => expect(like).toBeEnabled()); // enabled via the per-series lookup
    await act(async () => void fireEvent.click(like));
    await act(async () => resolveFirst(ok({ items: [{ series_id: "s1", is_liked: false, is_favorite: false }], next_cursor: null })));
    expect(screen.getByLabelText("Liked").getAttribute("aria-pressed")).toBe("true");
  });

  it("merges engagement from later pages for a signed-in viewer", async () => {
    GET.mockImplementation(async (_p: string, o: { params: { query: { cursor?: string } } }) =>
      o.params.query.cursor
        ? ok({ items: [item(4), item(5)].map((i) => ({ ...i, is_liked: true, is_favorite: true })), next_cursor: null })
        : ok({ items: [{ series_id: "s1", is_liked: false, is_favorite: false }, { series_id: "s2", is_liked: false, is_favorite: false }, { series_id: "s3", is_liked: false, is_favorite: false }], next_cursor: "c" }),
    );
    mount({ initial: [item(1), item(2), item(3)] as never, nextCursor: "c" });
    await waitFor(() => expect(screen.getAllByLabelText("Like").every((b) => !(b as HTMLButtonElement).disabled)).toBe(true));
    await scrollTo(entry(3, 0.9));
    await screen.findByText("Show 5");
    expect(screen.getAllByLabelText("Liked")).toHaveLength(2);
  });

  it("does not hydrate twice for the same user", async () => {
    hydrated();
    const { rerender } = mount({ initial: [item(1)] as never });
    await waitFor(() => expect(GET).toHaveBeenCalled());
    const n = GET.mock.calls.length;
    rerender(<ShortsFeed initial={[item(1)] as never} nextCursor={null} lang="en" />);
    expect(GET.mock.calls.length).toBe(n);
  });

  it("does not show another account's engagement after a user switch", async () => {
    hydrated(true);
    const { rerender } = mount({ initial: [item(1)] as never });
    await screen.findByLabelText("Liked");
    setAuth({ status: "authenticated", user: { ...aUser, id: "u2" } as never });
    GET.mockImplementation(async () => new Promise(() => {}));
    rerender(<ShortsFeed initial={[item(1)] as never} nextCursor={null} lang="en" />);
    expect(await screen.findByLabelText("Like")).toBeDisabled();
  });
});

describe("share", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it("copies a link with UTM and the episode path when the share sheet is unavailable", async () => {
    mount({ initial: [item(1, { episode_number: 3 })] as never });
    await waitFor(() => expect(POST).toHaveBeenCalled());
    await act(async () => void fireEvent.click(screen.getByLabelText("Share")));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/series/show-1/3?utm_source=share`);
    expect(toast).toHaveBeenCalledWith("Link copied", "success");
    expect(track).toHaveBeenCalledWith("share", expect.objectContaining({ method: "clipboard", surface: "shorts" }));
  });

  it("uses the native sheet with the viewer's referral code and the series page for episode 1", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    setAuth({ status: "authenticated", user: { ...aUser, referral_code: "REF123" } as never });
    GET.mockResolvedValue(ok({ items: [], next_cursor: null }));
    mount({ initial: [item(1)] as never }, "hi");
    await waitFor(() => expect(POST).toHaveBeenCalled());
    await act(async () => void fireEvent.click(screen.getByLabelText("Share")));
    expect(share).toHaveBeenCalledWith({
      title: "Show 1",
      text: "Synopsis 1",
      url: `${window.location.origin}/hi/series/show-1?utm_source=share&ref=REF123`,
    });
    expect(track).toHaveBeenCalledWith("share", expect.objectContaining({ method: "native" }));
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });

  it("is silent when the viewer cancels", async () => {
    Object.defineProperty(navigator, "share", { value: vi.fn().mockRejectedValue(new Error("AbortError")), configurable: true });
    mount({ initial: [item(1, { synopsis: null })] as never });
    await waitFor(() => expect(POST).toHaveBeenCalled());
    await act(async () => void fireEvent.click(screen.getByLabelText("Share")));
    expect(toast).not.toHaveBeenCalled();
  });
});
