import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";
import { auth, setAuth } from "@/test-utils/auth-context";
import { nav, resetNav } from "@/test-utils/next-navigation";
import { ProfileView } from "./ProfileView";

vi.mock("next/navigation", () => import("@/test-utils/next-navigation"));
vi.mock("@/lib/auth-context", () => import("@/test-utils/auth-context"));
const GET = vi.fn();
const POST = vi.fn();
const PATCH = vi.fn();
const DELETE = vi.fn();
vi.mock("@/lib/client-api", () => ({
  clientApi: {
    GET: (...a: unknown[]) => GET(...a),
    POST: (...a: unknown[]) => POST(...a),
    PATCH: (...a: unknown[]) => PATCH(...a),
    DELETE: (...a: unknown[]) => DELETE(...a),
  },
}));
const toast = vi.fn();
vi.mock("@/lib/toast", () => ({ useToast: () => toast }));
vi.mock("./ReferralCard", () => ({ ReferralCard: () => <div data-testid="referral" /> }));

HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  this.removeAttribute("open");
  this.dispatchEvent(new Event("close"));
};

const ok = (data: unknown) => ({ data, response: { ok: true, status: 200 } });
const fail = (message = "bad") => ({ error: { detail: { code: "e", message } }, response: { ok: false, status: 400 } });

const user = {
  id: "u1",
  public_id: "KATHA-1",
  email: "ann@example.com",
  phone: null,
  display_name: "Ann",
  avatar_url: null,
  locale: "hi",
  coin_balance: 120,
  is_vip: true,
  created_at: "2026-01-05T00:00:00Z",
};
const sess = (id: string, over: object = {}) => ({
  id,
  platform: "web",
  device_name: `Dev ${id}`,
  app_version: "web-0.1.0",
  current: false,
  last_seen_at: null,
  created_at: new Date().toISOString(),
  ...over,
});

let sessions: unknown[];
function mount(lang = "en") {
  return render(<ProfileView />, { wrapper: appWrapper({ lang }) });
}
const fillSessions = async () => {
  await screen.findByText("Signed-in devices");
};

beforeEach(() => {
  resetNav("/profile");
  [GET, POST, PATCH, DELETE].forEach((m) => m.mockReset());
  toast.mockReset();
  setAuth({ status: "authenticated", user: user as never });
  sessions = [sess("s1", { current: true }), sess("s2", { app_version: null, device_name: null })];
  GET.mockImplementation(async (path: string) => (path === "/v1/auth/sessions" ? ok(sessions) : ok({ export: true })));
});
afterEach(() => vi.unstubAllGlobals());

describe("header and details", () => {
  it("gates on sign-in", () => {
    setAuth({ status: "anonymous" });
    mount();
    expect(screen.getByText("Sign in to continue")).toBeInTheDocument();
  });

  it("renders nothing inside the gate if the user has not arrived", () => {
    setAuth({ status: "authenticated", user: null });
    const { container } = mount();
    expect(container.innerHTML).toBe("");
  });

  it("shows the account summary", async () => {
    mount();
    expect(screen.getByText("Profile")).toBeInTheDocument();
    expect(screen.getByText("ann@example.com")).toBeInTheDocument();
    expect(screen.getByText("Ann", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText(/120 coins/)).toBeInTheDocument();
    expect(screen.getByText("VIP")).toBeInTheDocument();
    expect(screen.getByText(/Member since/)).toHaveTextContent("Jan 5, 2026");
    expect(screen.getByText("A")).toBeInTheDocument(); // avatar initial
    expect(screen.getByTestId("referral")).toBeInTheDocument();
    await fillSessions();
  });

  it("falls back to phone/public id for the subtitle and placeholder names", async () => {
    setAuth({ status: "authenticated", user: { ...user, email: null, phone: "+911", display_name: null, is_vip: false, avatar_url: "https://img/a.png", locale: "xx" } as never });
    const { unmount } = mount();
    expect(screen.getByText("+911")).toBeInTheDocument();
    expect(screen.getByText("Katha viewer")).toBeInTheDocument();
    expect(screen.queryByText("VIP")).toBeNull();
    expect(document.querySelector("img")!.getAttribute("src")).toContain("img/a.png");
    // an unknown locale is kept as an option
    expect(screen.getByRole("option", { name: "xx" })).toBeInTheDocument();
    await fillSessions();
    unmount();
    setAuth({ status: "authenticated", user: { ...user, email: null, phone: null, display_name: null, locale: "en" } as never });
    mount();
    expect(screen.getByText("KATHA-1")).toBeInTheDocument();
    expect(screen.getByText("?")).toBeInTheDocument();
    await fillSessions();
  });
});

describe("saving the profile", () => {
  it("PATCHes name, avatar and locale, refreshes and toasts", async () => {
    PATCH.mockResolvedValue(ok({}));
    mount();
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "  Bob  " } });
    fireEvent.change(screen.getByLabelText("Preferred language"), { target: { value: "en" } });
    await act(async () => void fireEvent.click(screen.getByText("Save changes")));
    expect(PATCH).toHaveBeenCalledWith("/v1/auth/me", { body: { display_name: "Bob", avatar_url: null, locale: "en" } });
    expect(auth.refreshUser).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Profile saved", "success");
  });

  it("refuses a non-https avatar link without calling the API", async () => {
    setAuth({ status: "authenticated", user: { ...user, avatar_url: "http://insecure/a.png" } as never });
    mount();
    await act(async () => void fireEvent.click(screen.getByText("Save changes")));
    expect(screen.getByRole("alert")).toHaveTextContent("The avatar link must start with https://");
    expect(PATCH).not.toHaveBeenCalled();
  });

  it("sends null for a blank name", async () => {
    PATCH.mockResolvedValue(ok({}));
    mount();
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "   " } });
    await act(async () => void fireEvent.click(screen.getByText("Save changes")));
    expect(PATCH.mock.calls[0][1].body.display_name).toBeNull();
  });

  it("shows the API error inline", async () => {
    PATCH.mockResolvedValue(fail("Name taken"));
    mount();
    await act(async () => void fireEvent.click(screen.getByText("Save changes")));
    expect(screen.getByRole("alert")).toHaveTextContent("Name taken");
    expect(auth.refreshUser).not.toHaveBeenCalled();
  });
});

describe("avatar upload", () => {
  const file = (name: string, type: string, size = 10) => {
    const f = new File(["x"], name, { type });
    Object.defineProperty(f, "size", { value: size });
    return f;
  };
  const choose = async (f?: File) => {
    const input = screen.getByLabelText("Change photo", { selector: "input" }) as HTMLInputElement;
    Object.defineProperty(input, "files", { value: f ? [f] : [], configurable: true });
    await act(async () => void fireEvent.change(input));
  };

  it("the visible button opens the file picker", () => {
    mount();
    const input = screen.getByLabelText("Change photo", { selector: "input" }) as HTMLInputElement;
    const click = vi.spyOn(input, "click");
    fireEvent.click(screen.getByText("Change photo", { selector: "button" }));
    expect(click).toHaveBeenCalled();
  });

  it("ignores an empty selection", async () => {
    mount();
    await choose();
    expect(POST).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("rejects wrong types and oversize images before any request", async () => {
    mount();
    await choose(file("a.pdf", "application/pdf"));
    expect(toast).toHaveBeenLastCalledWith("Choose a JPG, PNG, WebP or GIF image.", "error");
    await choose(file("a.png", "image/png", 6 * 1024 * 1024));
    expect(toast).toHaveBeenLastCalledWith("Images must be under 5 MB.", "error");
    expect(POST).not.toHaveBeenCalled();
  });

  it("presigns, PUTs with the same content type, patches and refreshes", async () => {
    POST.mockResolvedValue(ok({ upload_url: "https://s3/put", public_url: "https://cdn/a.png" }));
    PATCH.mockResolvedValue(ok({}));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    mount();
    const f = file("a.png", "image/png");
    await choose(f);
    expect(POST).toHaveBeenCalledWith("/v1/auth/me/avatar/presign", { body: { filename: "a.png", content_type: "image/png" } });
    expect(fetchMock).toHaveBeenCalledWith("https://s3/put", { method: "PUT", headers: { "Content-Type": "image/png" }, body: f });
    expect(PATCH).toHaveBeenCalledWith("/v1/auth/me", { body: { avatar_url: "https://cdn/a.png" } });
    expect(auth.refreshUser).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Avatar updated", "success");
    expect(document.querySelector("img")!.getAttribute("src")).toContain("cdn/a.png");
  });

  it("surfaces a presign error", async () => {
    POST.mockResolvedValue(fail("no presign"));
    mount();
    await choose(file("a.png", "image/png"));
    expect(toast).toHaveBeenCalledWith("no presign", "error");
  });

  it("surfaces a storage rejection", async () => {
    POST.mockResolvedValue(ok({ upload_url: "https://s3/put", public_url: "https://cdn/a.png" }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    mount();
    await choose(file("a.png", "image/png"));
    expect(toast).toHaveBeenCalledWith("The upload was rejected by storage (403).", "error");
    expect(PATCH).not.toHaveBeenCalled();
  });

  it("surfaces a patch failure and a non-Error throw", async () => {
    POST.mockResolvedValue(ok({ upload_url: "https://s3/put", public_url: "https://cdn/a.png" }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    PATCH.mockResolvedValue(fail("patch failed"));
    mount();
    await choose(file("a.png", "image/png"));
    expect(toast).toHaveBeenCalledWith("patch failed", "error");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue("weird"));
    await choose(file("b.png", "image/png"));
    expect(toast).toHaveBeenLastCalledWith("The upload failed.", "error");
  });
});

describe("sessions", () => {
  it("lists devices, marks the current one and only offers revoke for others", async () => {
    mount();
    expect(await screen.findByText("Dev s1")).toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();
    const s1 = screen.getByText("Dev s1").closest("li")!;
    expect(within(s1).queryByText("Revoke")).toBeNull();
    expect(s1).toHaveTextContent("web · web-0.1.0");
    // device_name falls back to platform; no version
    const s2 = screen.getAllByRole("listitem").find((li) => li.textContent?.startsWith("web") && li.querySelector("button"))!;
    expect(s2).not.toHaveTextContent("web-0.1.0");
  });

  it("revokes a session", async () => {
    DELETE.mockResolvedValue(ok(null));
    mount();
    const row = (await screen.findAllByRole("listitem")).find((li) => li.querySelector("button"))!;
    await act(async () => void fireEvent.click(within(row).getByText("Revoke")));
    expect(DELETE).toHaveBeenCalledWith("/v1/auth/sessions/{session_id}", { params: { path: { session_id: "s2" } } });
    expect(screen.queryByText("Revoke")).toBeNull();
  });

  it("toasts when revoking fails", async () => {
    DELETE.mockResolvedValue(fail("nope"));
    mount();
    const revoke = await screen.findByText("Revoke");
    await act(async () => void fireEvent.click(revoke));
    expect(toast).toHaveBeenCalledWith("nope", "error");
    expect(screen.getByText("Revoke")).toBeInTheDocument();
  });

  it("empty and error states, with retry", async () => {
    sessions = [];
    const { unmount } = mount();
    expect(await screen.findByText("No other sessions")).toBeInTheDocument();
    unmount();
    GET.mockResolvedValueOnce(fail());
    mount();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    sessions = [sess("s9")];
    await act(async () => void fireEvent.click(screen.getByText("Try again")));
    expect(await screen.findByText("Dev s9")).toBeInTheDocument();
  });
});

describe("sign out", () => {
  it("signs out", async () => {
    mount();
    await act(async () => void fireEvent.click(screen.getByText("Sign out")));
    expect(auth.signOut).toHaveBeenCalled();
    await fillSessions();
  });
});

describe("data export", () => {
  it("downloads the JSON as a dated file", async () => {
    let blob: Blob | undefined;
    URL.createObjectURL = vi.fn((b: Blob) => ((blob = b), "blob:1")) as never;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    mount();
    await act(async () => void fireEvent.click(screen.getByText("Download data")));
    expect(GET).toHaveBeenCalledWith("/v1/me/export");
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toMatch(/^katha-data-\d{4}-\d{2}-\d{2}\.json$/);
    expect(JSON.parse(await blob!.text())).toEqual({ export: true });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:1");
    expect(screen.queryByText("Could not prepare your data.")).toBeNull();
  });

  it("shows the API error, or a default when there is no data", async () => {
    GET.mockImplementation(async (p: string) => (p === "/v1/auth/sessions" ? ok(sessions) : fail("export broke")));
    const { unmount } = mount();
    await act(async () => void fireEvent.click(screen.getByText("Download data")));
    expect(await screen.findByText("export broke")).toBeInTheDocument();
    unmount();
    GET.mockImplementation(async (p: string) => (p === "/v1/auth/sessions" ? ok(sessions) : { data: undefined, response: { ok: true, status: 200 } }));
    mount();
    await act(async () => void fireEvent.click(screen.getByText("Download data")));
    expect(await screen.findByText("Could not prepare your data.")).toBeInTheDocument();
  });
});

describe("delete account", () => {
  const open = () => {
    fireEvent.click(screen.getAllByText("Delete account", { selector: "button" })[0]);
    return screen.getByLabelText("Type DELETE to confirm").closest("dialog")!;
  };

  it("requires typing DELETE and then deletes, signs out and goes home", async () => {
    DELETE.mockResolvedValue(ok(null));
    mount("hi");
    const dlg = open();
    const confirm = within(dlg).getByText("Delete account", { selector: "button" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: "nope" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: " delete " } });
    expect(confirm).toBeEnabled();
    await act(async () => void fireEvent.click(confirm));
    expect(DELETE).toHaveBeenCalledWith("/v1/auth/me");
    expect(auth.signOut).toHaveBeenCalled();
    expect(nav.router.replace).toHaveBeenCalledWith("/hi");
  });

  it("toasts and stays signed in when deletion fails", async () => {
    DELETE.mockResolvedValue(fail("cannot delete"));
    mount();
    const dlg = open();
    fireEvent.change(screen.getByLabelText("Type DELETE to confirm"), { target: { value: "DELETE" } });
    await act(async () => void fireEvent.click(within(dlg).getByText("Delete account", { selector: "button" })));
    expect(toast).toHaveBeenCalledWith("cannot delete", "error");
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("cancel closes without deleting", async () => {
    mount();
    const dlg = open();
    fireEvent.click(within(dlg).getByText("Cancel"));
    expect(dlg.hasAttribute("open")).toBe(false);
    expect(DELETE).not.toHaveBeenCalled();
    await waitFor(() => expect(GET).toHaveBeenCalled());
  });
});
