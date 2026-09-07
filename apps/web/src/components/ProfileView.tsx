"use client";

import Image from "next/image";
import { useCallback, useRef, useState } from "react";
import { useApp, useT } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { clientApi } from "@/lib/client-api";
import { call, type ApiError } from "@/lib/errors";
import { formatDate, formatRelative } from "@/lib/format";
import { useToast } from "@/lib/toast";
import type { SessionOut } from "@/lib/types";
import { useLoader } from "@/lib/use-loader";
import { ReferralCard } from "./ReferralCard";
import { PageTitle, RequireAuth } from "./RequireAuth";
import { Button } from "./ui/Button";
import { EmptyState, ErrorState, Field, Skeleton, inputClass } from "./ui/states";
import { IconCoin, IconLogout, IconUpload } from "./ui/icons";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export function ProfileView() {
  return (
    <RequireAuth>
      <ProfileInner />
    </RequireAuth>
  );
}

function ProfileInner() {
  const t = useT();
  const toast = useToast();
  const { lang, languages } = useApp();
  const { user, refreshUser, signOut } = useAuth();
  // RequireAuth guarantees `user` here; the form is seeded once and remounts on sign-out/sign-in.
  const [name, setName] = useState(() => user?.display_name ?? "");
  const [avatar, setAvatar] = useState(() => user?.avatar_url ?? "");
  const [locale, setLocale] = useState(() => user?.locale ?? lang);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sessions, setSessions] = useState<SessionOut[] | null>(null);
  const [sessionsError, setSessionsError] = useState<ApiError | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadSessions = useCallback(async () => {
    const { data, error } = await call(() => clientApi.GET("/v1/auth/sessions"));
    if (error) return setSessionsError(error);
    setSessionsError(null);
    setSessions(data);
  }, []);

  useLoader(loadSessions);

  const save = async () => {
    const url = avatar.trim();
    if (url && !/^https:\/\/[^\s]+$/i.test(url)) {
      setSaveError(t("profile.avatar_https", "The avatar link must start with https://"));
      return;
    }
    setSaving(true);
    setSaveError(null);
    const { error } = await call(() =>
      clientApi.PATCH("/v1/auth/me", {
        body: { display_name: name.trim() || null, avatar_url: avatar.trim() || null, locale },
      }),
    );
    setSaving(false);
    if (error) return setSaveError(error.message);
    await refreshUser();
    toast(t("profile.saved", "Profile saved"), "success");
  };

  /** Presign → PUT the file with the same Content-Type → PATCH avatar_url. */
  const uploadAvatar = async (file: File) => {
    if (!AVATAR_TYPES.includes(file.type)) {
      toast(t("profile.avatar_type", "Choose a JPG, PNG, WebP or GIF image."), "error");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast(t("profile.avatar_too_large", "Images must be under 5 MB."), "error");
      return;
    }
    setUploading(true);
    try {
      const presign = await call(() =>
        clientApi.POST("/v1/auth/me/avatar/presign", { body: { filename: file.name, content_type: file.type } }),
      );
      if (presign.error) throw new Error(presign.error.message);
      const put = await fetch(presign.data.upload_url, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error(t("profile.avatar_upload_rejected", "The upload was rejected by storage ({status}).", { status: put.status }));
      const patched = await call(() => clientApi.PATCH("/v1/auth/me", { body: { avatar_url: presign.data.public_url } }));
      if (patched.error) throw new Error(patched.error.message);
      setAvatar(presign.data.public_url);
      await refreshUser();
      toast(t("profile.avatar_saved", "Avatar updated"), "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : t("profile.avatar_upload_failed", "The upload failed."), "error");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const revoke = async (id: string) => {
    setRevoking(id);
    const { error } = await call(() => clientApi.DELETE("/v1/auth/sessions/{session_id}", { params: { path: { session_id: id } } }));
    setRevoking(null);
    if (error) return toast(error.message, "error");
    setSessions((s) => s?.filter((x) => x.id !== id) ?? null);
  };

  if (!user) return null;

  return (
    <div>
      <PageTitle sub={user.email || user.phone || user.public_id}>{t("profile.title", "Profile")}</PageTitle>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="rounded-lg border border-line bg-surface p-5">
          <div className="flex items-center gap-4">
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-pill border border-line bg-surface2">
              {avatar ? (
                <Image src={avatar} alt="" fill sizes="64px" unoptimized className="object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center font-display text-2xl font-semibold uppercase text-ink2">
                  {(name || user.email || "?").slice(0, 1)}
                </span>
              )}
              {uploading && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <span className="h-5 w-5 animate-spin rounded-pill border-2 border-ink/30 border-t-ink" />
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-lg font-semibold text-ink">{user.display_name || t("profile.anonymous", "Katha viewer")}</p>
              <p className="inline-flex items-center gap-1 text-sm text-gold">
                <IconCoin size={14} />
                {user.coin_balance} {t("wallet.coins", "coins")}
                {user.is_vip && <span className="ms-2 rounded-pill bg-gold/15 px-2 py-0.5 text-[11px] font-semibold uppercase">VIP</span>}
              </p>
              <p className="text-xs text-muted">
                {t("profile.member_since", "Member since")} {formatDate(user.created_at, lang)}
              </p>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept={AVATAR_TYPES.join(",")}
              className="sr-only"
              aria-label={t("profile.change_avatar", "Change photo")}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadAvatar(f);
              }}
            />
            <Button variant="secondary" size="sm" loading={uploading} onClick={() => fileInput.current?.click()}>
              <IconUpload size={14} />
              {t("profile.change_avatar", "Change photo")}
            </Button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
            className="mt-6 flex flex-col gap-4"
          >
            <Field label={t("profile.display_name", "Display name")} htmlFor="p-name">
              <input id="p-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={inputClass} autoComplete="nickname" />
            </Field>
            <Field label={t("profile.avatar_url", "Avatar URL")} htmlFor="p-avatar" hint={t("profile.avatar_hint", "Upload a photo above, or paste a link to an image.")}>
              <input
                id="p-avatar"
                type="url"
                value={avatar}
                onChange={(e) => setAvatar(e.target.value)}
                className={inputClass}
                placeholder="https://"
                pattern="https://.*"
                dir="ltr"
              />
            </Field>
            <Field label={t("profile.locale", "Preferred language")} htmlFor="p-locale">
              <select id="p-locale" value={locale} onChange={(e) => setLocale(e.target.value)} className={inputClass}>
                {languages.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.native_name || l.name}
                  </option>
                ))}
                {!languages.some((l) => l.code === locale) && <option value={locale}>{locale}</option>}
              </select>
            </Field>
            {saveError && (
              <p role="alert" className="text-sm text-danger">
                {saveError}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" loading={saving}>
                {t("common.save", "Save changes")}
              </Button>
            </div>
          </form>
        </section>

        {/* The code used to sit here as a 12px caption with no link and no stated reward. */}
        <ReferralCard />

        <section className="flex flex-col gap-4">
          <div className="rounded-lg border border-line bg-surface p-5">
            <h2 className="font-display text-lg font-semibold text-ink">{t("profile.sessions", "Signed-in devices")}</h2>
            {sessionsError ? (
              <ErrorState className="mt-3" error={sessionsError} onRetry={loadSessions} />
            ) : !sessions ? (
              <div className="mt-3 flex flex-col gap-2">
                {[0, 1].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : sessions.length === 0 ? (
              <EmptyState className="mt-3" title={t("profile.no_sessions", "No other sessions")} />
            ) : (
              <ul className="mt-3 flex flex-col divide-y divide-line">
                {sessions.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">
                        {s.device_name || s.platform}
                        {s.current && <span className="ms-2 rounded-pill bg-success/15 px-2 py-0.5 text-[11px] text-success">{t("profile.this_device", "This device")}</span>}
                      </p>
                      <p className="text-xs text-muted">
                        {s.platform}
                        {s.app_version ? ` · ${s.app_version}` : ""} · {t("profile.last_seen", "last seen")} {formatRelative(s.last_seen_at ?? s.created_at, lang)}
                      </p>
                    </div>
                    {!s.current && (
                      <Button variant="danger" size="sm" onClick={() => revoke(s.id)} loading={revoking === s.id}>
                        {t("profile.revoke", "Revoke")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-line bg-surface p-5">
            <h2 className="font-display text-lg font-semibold text-ink">{t("profile.account", "Account")}</h2>
            <p className="mt-1 text-sm text-muted">{t("profile.sign_out_hint", "Signing out removes this device from your sessions.")}</p>
            <Button
              variant="secondary"
              className="mt-3"
              loading={signingOut}
              onClick={async () => {
                setSigningOut(true);
                await signOut();
                setSigningOut(false);
              }}
            >
              <IconLogout size={16} />
              {t("auth.sign_out", "Sign out")}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
