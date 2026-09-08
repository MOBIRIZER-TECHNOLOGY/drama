"use client";

import { useState, type FormEvent } from "react";
import { api, call } from "@/lib/api";
import { setToken } from "@/lib/token";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, Field, Input, Modal } from "@/components/ui";

/**
 * Two-factor enrolment and session revocation for the signed-in admin.
 *
 * The console holds every lever in the product — coin grants, bans, takedowns, price changes — and until now
 * one password and an eight-hour token were the whole of the defence. `totp_secret` had been in the schema
 * since the first migration with nothing writing to it.
 *
 * Enrolment is deliberately two steps: the server hands back a candidate secret and stores nothing until a
 * code proves the authenticator actually holds it, so an abandoned setup cannot leave an account half-enrolled
 * and locked out.
 */
export function TwoFactorCard({ enabled, onChange }: { enabled: boolean; onChange: (enabled: boolean) => void }) {
  const toast = useToast();
  const [setup, setSetup] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [busy, setBusy] = useState(false);

  async function begin() {
    setBusy(true);
    try {
      setSetup(await call(api.POST("/v1/admin/auth/totp/setup")));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start setup");
    } finally {
      setBusy(false);
    }
  }

  async function signOutEverywhere() {
    setBusy(true);
    try {
      const token = await call(api.POST("/v1/admin/auth/sign-out-all"));
      // A fresh token for this tab: the person clicking it is not trying to sign themselves out of the
      // window they are looking at.
      setToken(token.access_token, token.expires_in);
      toast.success("Signed out everywhere else");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not revoke sessions");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card title="Your security">
        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium text-ink">
                Two-factor authentication
                {enabled ? <Badge tone="success">on</Badge> : <Badge tone="warning">off</Badge>}
              </p>
              <p className="mt-0.5 max-w-prose text-xs text-muted">
                {enabled
                  ? "A code from your authenticator app is required alongside your password."
                  : "Without it, one password is all that stands between a phished inbox and every coin balance in the product."}
              </p>
            </div>
            {enabled ? (
              <Button size="sm" onClick={() => setDisabling(true)}>
                Turn off
              </Button>
            ) : (
              <Button size="sm" variant="primary" loading={busy} onClick={begin}>
                Set up
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <div>
              <p className="text-sm font-medium text-ink">Sign out everywhere else</p>
              <p className="mt-0.5 max-w-prose text-xs text-muted">
                Ends every other session immediately. Admin tokens last eight hours, so without this a laptop
                left behind stays signed in until it expires on its own.
              </p>
            </div>
            <Button size="sm" loading={busy} onClick={signOutEverywhere}>
              Sign out others
            </Button>
          </div>
        </div>
      </Card>

      {setup && (
        <EnrolDialog
          setup={setup}
          onClose={() => setSetup(null)}
          onEnabled={() => {
            setSetup(null);
            onChange(true);
          }}
        />
      )}

      {disabling && (
        <DisableDialog
          onClose={() => setDisabling(false)}
          onDisabled={() => {
            setDisabling(false);
            onChange(false);
          }}
        />
      )}
    </>
  );
}

function EnrolDialog({
  setup,
  onClose,
  onEnabled,
}: {
  setup: { secret: string; otpauth_uri: string };
  onClose: () => void;
  onEnabled: () => void;
}) {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await call(api.POST("/v1/admin/auth/totp/enable", { body: { secret: setup.secret, code: code.trim() } }));
      toast.success("Two-factor authentication is on");
      onEnabled();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code was not accepted");
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!saving}
      title="Set up two-factor authentication"
      width="max-w-md"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="totp-form" variant="primary" loading={saving} disabled={code.trim().length < 6}>
            Turn on
          </Button>
        </>
      }
    >
      <form id="totp-form" onSubmit={submit} className="grid gap-4" noValidate>
        <ol className="grid gap-2 text-sm text-ink-2">
          <li>1. Open your authenticator app and add an account.</li>
          <li>2. Choose &ldquo;enter a setup key&rdquo; and paste the key below.</li>
          <li>3. Type the six digits it shows to confirm.</li>
        </ol>
        <Field label="Setup key" hint="Store this somewhere safe until you have confirmed the code below.">
          {/* Read-only and selectable rather than a QR image: generating one would mean shipping a library to
              render a string the app will accept typed. */}
          <Input readOnly value={setup.secret} onFocus={(e) => e.currentTarget.select()} className="font-mono" />
        </Field>
        <Field label="Code from the app" required error={error ?? undefined}>
          <Input
            data-autofocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setError(null);
            }}
          />
        </Field>
      </form>
    </Modal>
  );
}

function DisableDialog({ onClose, onDisabled }: { onClose: () => void; onDisabled: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await call(api.POST("/v1/admin/auth/totp/disable", { body: { password, code: code.trim() } }));
      toast.success("Two-factor authentication is off");
      onDisabled();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not turn it off");
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!saving}
      title="Turn off two-factor authentication"
      width="max-w-md"
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="totp-off" variant="danger" loading={saving} disabled={!password || code.trim().length < 6}>
            Turn off
          </Button>
        </>
      }
    >
      <form id="totp-off" onSubmit={submit} className="grid gap-4" noValidate>
        {/* Both factors to remove a factor: otherwise a stolen session could quietly disarm it. */}
        <p className="text-sm text-muted">Confirm with both your password and a current code.</p>
        <Field label="Password" required>
          <Input data-autofocus type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Code from the app" required error={error ?? undefined}>
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setError(null);
            }}
          />
        </Field>
      </form>
    </Modal>
  );
}
