"use client";

import { useEffect, useRef, useState } from "react";
import { useApp, useT } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { clientApi } from "@/lib/client-api";
import { call } from "@/lib/errors";
import { PageTitle } from "./RequireAuth";

/** Support categories, in the order they are offered. Payment leads because it is the largest volume. */
const TOPICS = ["payment", "playback", "account", "content", "other"] as const;
type Topic = (typeof TOPICS)[number];
import { Button } from "./ui/Button";
import { Field, inputClass } from "./ui/states";
import { IconCheck } from "./ui/icons";

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadTurnstile(): Promise<TurnstileApi | null> {
  return new Promise((resolve) => {
    if (window.turnstile) return resolve(window.turnstile);
    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile="1"]');
    const done = () => resolve(window.turnstile ?? null);
    if (existing) {
      existing.addEventListener("load", done, { once: true });
      existing.addEventListener("error", () => resolve(null), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = TURNSTILE_SRC;
    s.async = true;
    s.dataset.turnstile = "1";
    s.onload = done;
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
}

/** Cloudflare Turnstile widget; reports the token (or null when expired/reset) to the parent. */
function Turnstile({ siteKey, onToken, resetKey }: { siteKey: string; onToken: (token: string | null) => void; resetKey: number }) {
  const host = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);
  const t = useT();

  useEffect(() => {
    let cancelled = false;
    void loadTurnstile().then((api) => {
      if (cancelled || !host.current) return;
      if (!api) {
        setFailed(true);
        return;
      }
      widgetId.current = api.render(host.current, {
        sitekey: siteKey,
        theme: "dark",
        callback: (token: string) => onToken(token),
        "expired-callback": () => onToken(null),
        "error-callback": () => onToken(null),
      });
    });
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
          /* widget already gone */
        }
      }
      widgetId.current = null;
    };
  }, [siteKey, onToken]);

  useEffect(() => {
    if (resetKey > 0 && widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
  }, [resetKey]);

  return (
    <div>
      <div ref={host} />
      {failed && <p className="text-xs text-warning">{t("contact.captcha_failed", "The verification widget could not be loaded. Please disable blockers and reload.")}</p>}
    </div>
  );
}

export function ContactForm() {
  const t = useT();
  const { config } = useApp();
  const { user } = useAuth();
  const siteKey = config?.site?.captcha_site_key || null;
  // null = untouched, so the signed-in user's details prefill until the viewer types.
  const [nameInput, setName] = useState<string | null>(null);
  const [emailInput, setEmail] = useState<string | null>(null);
  const name = nameInput ?? user?.display_name ?? "";
  const email = emailInput ?? user?.email ?? "";
  const [subject, setSubject] = useState("");
  const [topic, setTopic] = useState<Topic>(TOPICS[0]);

  // Written out rather than built from a template key, so the extractor sees them and they can be translated.
  const topicLabel: Record<Topic, string> = {
    payment: t("contact.topic_payment", "Payment or coins"),
    playback: t("contact.topic_playback", "Video will not play"),
    account: t("contact.topic_account", "My account"),
    content: t("contact.topic_content", "Report or request a drama"),
    other: t("contact.topic_other", "Something else"),
  };
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);

  const submit = async () => {
    if (siteKey && !captcha) {
      setError(t("contact.captcha_required", "Please complete the verification first."));
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await call(() =>
      clientApi.POST("/v1/contact", {
        body: {
          name: name.trim(),
          email: email.trim(),
          // Prefixed rather than sent as a separate field: the inbox sorts and scans on subject already.
          subject: `[${topicLabel[topic]}] ${subject.trim()}`.trim(),
          message: message.trim(),
          captcha_token: captcha,
        },
      }),
    );
    setBusy(false);
    if (error) {
      setCaptcha(null);
      setCaptchaReset((k) => k + 1);
      return setError(error.message);
    }
    setSent(true);
  };

  return (
    <div className="mx-auto max-w-xl">
      <PageTitle sub={t("contact.subtitle", "Questions, feedback or a problem with a payment — we read everything.")}>{t("contact.title", "Contact us")}</PageTitle>
      {sent ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-success/40 bg-surface p-8 text-center">
          <span className="rounded-pill bg-success/15 p-3 text-success">
            <IconCheck size={28} />
          </span>
          <h2 className="font-display text-xl font-semibold text-ink">{t("contact.sent_title", "Message sent")}</h2>
          <p className="text-sm text-muted">{t("contact.sent_message", "Thanks for reaching out. We will reply to your email.")}</p>
          <Button
            variant="secondary"
            onClick={() => {
              setSent(false);
              setMessage("");
              setSubject("");
              setCaptcha(null);
              setCaptchaReset((k) => k + 1);
            }}
          >
            {t("contact.another", "Send another")}
          </Button>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("contact.name", "Name")} htmlFor="c-name">
              <input id="c-name" required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} autoComplete="name" />
            </Field>
            <Field label={t("auth.email", "Email")} htmlFor="c-email">
              <input id="c-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} autoComplete="email" />
            </Field>
          </div>
          {/* Routing and response quality both depend on knowing what this is about, and payment problems are
              the largest single source of volume. The chosen topic is prefixed onto the subject, so the API and
              the admin inbox need no change to benefit from it. */}
          <Field label={t("contact.topic", "What is this about?")} htmlFor="c-topic">
            <select id="c-topic" value={topic} onChange={(e) => setTopic(e.target.value as Topic)} className={inputClass}>
              {TOPICS.map((key) => (
                <option key={key} value={key}>
                  {topicLabel[key]}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={t("contact.subject", "Subject (optional)")}
            htmlFor="c-subject"
            hint={topic === "payment" ? t("contact.payment_hint", "If this is about a payment, include the order id from your wallet history.") : undefined}
          >
            <input id="c-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass} maxLength={120} />
          </Field>
          <Field label={t("contact.message", "Message")} htmlFor="c-message">
            <textarea id="c-message" required rows={6} minLength={10} value={message} onChange={(e) => setMessage(e.target.value)} className={`${inputClass} h-auto py-2`} maxLength={4000} />
          </Field>
          {siteKey && <Turnstile siteKey={siteKey} onToken={setCaptcha} resetKey={captchaReset} />}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" loading={busy} disabled={!!siteKey && !captcha}>
            {t("contact.send", "Send message")}
          </Button>
        </form>
      )}
    </div>
  );
}
