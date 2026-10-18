import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appWrapper } from "@/test-utils/app";
import { aUser, setAuth } from "@/test-utils/auth-context";

vi.mock("@/lib/auth-context", () => import("@/test-utils/auth-context"));
const POST = vi.fn();
vi.mock("@/lib/client-api", () => ({ clientApi: { POST: (...a: unknown[]) => POST(...a) } }));

import { ContactForm } from "./ContactForm";

const ok = (data: unknown) => ({ data, response: { ok: true, status: 200 } });
const fail = (message: string) => ({ error: { detail: { code: "x", message } }, response: { ok: false, status: 400 } });

function fill() {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: " Ann " } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: " ann@x.co " } });
  fireEvent.change(screen.getByLabelText("Subject (optional)"), { target: { value: " Charged twice " } });
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: "  Please refund me. " } });
}
const send = () => fireEvent.submit(screen.getByLabelText("Message").closest("form")!);

beforeEach(() => {
  POST.mockReset();
  setAuth();
});

describe("ContactForm", () => {
  it("prefills from the signed-in user until the viewer types", () => {
    setAuth({ status: "authenticated", user: aUser });
    render(<ContactForm />, { wrapper: appWrapper() });
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Ann");
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("ann@example.com");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "" } });
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
  });

  it("is blank for guests, and shows the payment hint only for the payment topic", () => {
    render(<ContactForm />, { wrapper: appWrapper() });
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
    expect(screen.getByText(/order id from your wallet history/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("What is this about?"), { target: { value: "account" } });
    expect(screen.queryByText(/order id/)).toBeNull();
  });

  it("sends trimmed fields with the topic prefixed onto the subject, then shows the reference", async () => {
    POST.mockResolvedValue(ok({ reference: "REF-123" }));
    render(<ContactForm />, { wrapper: appWrapper() });
    fill();
    send();
    await screen.findByText("Message sent");
    expect(POST).toHaveBeenCalledWith("/v1/contact", {
      body: { name: "Ann", email: "ann@x.co", subject: "[Payment or coins] Charged twice", message: "Please refund me.", captcha_token: null },
    });
    expect(screen.getByText("REF-123")).toBeTruthy();
  });

  it("omits the reference block when the server returns none, and 'Send another' resets the form", async () => {
    POST.mockResolvedValue(ok({}));
    render(<ContactForm />, { wrapper: appWrapper() });
    fill();
    send();
    await screen.findByText("Message sent");
    expect(screen.queryByText("Your reference")).toBeNull();
    fireEvent.click(screen.getByText("Send another"));
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe("");
    expect((screen.getByLabelText("Subject (optional)") as HTMLInputElement).value).toBe("");
  });

  it("an empty subject sends just the topic tag", async () => {
    POST.mockResolvedValue(ok(null));
    render(<ContactForm />, { wrapper: appWrapper() });
    fill();
    fireEvent.change(screen.getByLabelText("Subject (optional)"), { target: { value: "" } });
    send();
    await screen.findByText("Message sent");
    expect(POST.mock.calls[0][1].body.subject).toBe("[Payment or coins]");
  });

  it("shows the API error and keeps the form", async () => {
    POST.mockResolvedValue(fail("Too many messages"));
    render(<ContactForm />, { wrapper: appWrapper() });
    fill();
    send();
    expect((await screen.findByRole("alert")).textContent).toBe("Too many messages");
    expect(screen.getByLabelText("Message")).toBeTruthy();
  });
});

describe("ContactForm captcha", () => {
  const config = { site: { captcha_site_key: "site-key" } } as never;
  let api: { render: ReturnType<typeof vi.fn>; reset: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    api = { render: vi.fn(() => "w1"), reset: vi.fn(), remove: vi.fn() };
  });
  afterEach(() => {
    delete window.turnstile;
    document.querySelectorAll('script[data-turnstile="1"]').forEach((s) => s.remove());
  });

  it("blocks submit until the widget yields a token, and disables the button", async () => {
    window.turnstile = api;
    render(<ContactForm />, { wrapper: appWrapper({ config }) });
    await waitFor(() => expect(api.render).toHaveBeenCalled());
    const opts = api.render.mock.calls[0][1];
    expect(opts.sitekey).toBe("site-key");
    const button = screen.getByText("Send message").closest("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fill();
    send();
    expect((await screen.findByRole("alert")).textContent).toBe("Please complete the verification first.");
    expect(POST).not.toHaveBeenCalled();
    act(() => opts.callback("tok"));
    expect(button.disabled).toBe(false);
    POST.mockResolvedValue(ok({ reference: "R" }));
    send();
    await screen.findByText("Message sent");
    expect(POST.mock.calls[0][1].body.captcha_token).toBe("tok");
  });

  it("expiry and widget errors clear the token", async () => {
    window.turnstile = api;
    render(<ContactForm />, { wrapper: appWrapper({ config }) });
    await waitFor(() => expect(api.render).toHaveBeenCalled());
    const opts = api.render.mock.calls[0][1];
    const button = screen.getByText("Send message").closest("button") as HTMLButtonElement;
    act(() => opts.callback("tok"));
    expect(button.disabled).toBe(false);
    act(() => opts["expired-callback"]());
    expect(button.disabled).toBe(true);
    act(() => opts.callback("tok"));
    act(() => opts["error-callback"]());
    expect(button.disabled).toBe(true);
  });

  it("resets the widget and token after a failed submit", async () => {
    window.turnstile = api;
    render(<ContactForm />, { wrapper: appWrapper({ config }) });
    await waitFor(() => expect(api.render).toHaveBeenCalled());
    act(() => api.render.mock.calls[0][1].callback("tok"));
    POST.mockResolvedValue(fail("nope"));
    fill();
    send();
    await screen.findByText("nope");
    await waitFor(() => expect(api.reset).toHaveBeenCalledWith("w1"));
    expect((screen.getByText("Send message").closest("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("tears the widget down on success, mounts a fresh one on 'Send another' and removes it on unmount", async () => {
    window.turnstile = api;
    const { unmount } = render(<ContactForm />, { wrapper: appWrapper({ config }) });
    await waitFor(() => expect(api.render).toHaveBeenCalled());
    act(() => api.render.mock.calls[0][1].callback("tok"));
    POST.mockResolvedValue(ok({ reference: "R" }));
    fill();
    send();
    await screen.findByText("Message sent");
    expect(api.remove).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Send another"));
    await waitFor(() => expect(api.render).toHaveBeenCalledTimes(2));
    expect((screen.getByText("Send message").closest("button") as HTMLButtonElement).disabled).toBe(true);
    unmount();
    expect(api.remove).toHaveBeenCalledTimes(2);
  });

  it("tolerates remove() throwing on teardown", async () => {
    window.turnstile = api;
    api.remove.mockImplementation(() => {
      throw new Error("gone");
    });
    const { unmount } = render(<ContactForm />, { wrapper: appWrapper({ config }) });
    await waitFor(() => expect(api.render).toHaveBeenCalled());
    expect(() => unmount()).not.toThrow();
  });

  it("injects the Turnstile script once and renders after it loads", async () => {
    render(<ContactForm />, { wrapper: appWrapper({ config }) });
    const script = document.querySelector<HTMLScriptElement>('script[data-turnstile="1"]')!;
    expect(script.src).toContain("challenges.cloudflare.com/turnstile");
    window.turnstile = api;
    act(() => script.onload!(new Event("load")));
    await waitFor(() => expect(api.render).toHaveBeenCalled());
  });

  it("a second form waits on the existing script", async () => {
    const a = render(<ContactForm />, { wrapper: appWrapper({ config }) });
    const b = render(<ContactForm />, { wrapper: appWrapper({ config }) });
    expect(document.querySelectorAll('script[data-turnstile="1"]')).toHaveLength(1);
    window.turnstile = api;
    const script = document.querySelector("script[data-turnstile='1']")!;
    act(() => void script.dispatchEvent(new Event("load")));
    await waitFor(() => expect(api.render).toHaveBeenCalledTimes(2));
    a.unmount();
    b.unmount();
  });

  it("warns when the script fails to load (fresh and shared script)", async () => {
    const a = render(<ContactForm />, { wrapper: appWrapper({ config }) });
    const script = document.querySelector<HTMLScriptElement>('script[data-turnstile="1"]')!;
    const b = render(<ContactForm />, { wrapper: appWrapper({ config }) });
    act(() => script.onerror!(new Event("error")));
    act(() => void script.dispatchEvent(new Event("error")));
    await waitFor(() => expect(screen.getAllByText(/verification widget could not be loaded/)).toHaveLength(2));
    a.unmount();
    b.unmount();
  });

  it("does not render into a form that unmounted before the script resolved", async () => {
    const { unmount } = render(<ContactForm />, { wrapper: appWrapper({ config }) });
    const script = document.querySelector<HTMLScriptElement>('script[data-turnstile="1"]')!;
    unmount();
    window.turnstile = api;
    act(() => script.onload!(new Event("load")));
    await Promise.resolve();
    expect(api.render).not.toHaveBeenCalled();
  });
});
