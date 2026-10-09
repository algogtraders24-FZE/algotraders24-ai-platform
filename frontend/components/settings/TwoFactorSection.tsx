"use client";
// components/settings/TwoFactorSection.tsx
// Settings > Two-factor authentication (authenticator app, TOTP) on top of Supabase MFA.
// Enable: scan the QR code, enter the first 6-digit code (that proves the app works) -> factor becomes active.
// Disable: remove the factor (Supabase only allows it in a session that already passed the code check).
import { useCallback, useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Alert from "@/components/ui/Alert";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { normalizeTotp } from "@/lib/auth/mfa";

interface Enrolling { factorId: string; qr: string; secret: string }

export default function TwoFactorSection() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [enrolling, setEnrolling] = useState<Enrolling | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase.auth.mfa.listFactors();
    setActiveId(data?.totp?.[0]?.id ?? null);
    setLoaded(true);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function startEnroll() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const supabase = createSupabaseBrowserClient();
    // A half-finished earlier attempt would block a new one with the same name; remove it first.
    const { data: all } = await supabase.auth.mfa.listFactors();
    for (const f of all?.all ?? []) if (f.factor_type === "totp" && f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error: err } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator app" });
    if (err || !data) {
      setError(/disabled/i.test(err?.message ?? "") ? "Two-factor authentication is not switched on for this project yet." : "Could not start the setup. Please try again.");
      setBusy(false);
      return;
    }
    setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    setCode("");
    setBusy(false);
  }

  async function confirmEnroll() {
    const digits = normalizeTotp(code);
    if (!enrolling || !digits) {
      setError("Enter the 6-digit code shown in your authenticator app.");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const challenge = await supabase.auth.mfa.challenge({ factorId: enrolling.factorId });
    if (challenge.error) {
      setError("Could not check the code. Please try again.");
      setBusy(false);
      return;
    }
    const verify = await supabase.auth.mfa.verify({ factorId: enrolling.factorId, challengeId: challenge.data.id, code: digits });
    if (verify.error) {
      setError("That code is not right. Wait for the next code in the app and try again.");
      setBusy(false);
      return;
    }
    setEnrolling(null);
    setNotice("Two-factor authentication is on. From now on you will be asked for a code when you sign in.");
    await load();
    setBusy(false);
  }

  async function cancelEnroll() {
    if (enrolling) await createSupabaseBrowserClient().auth.mfa.unenroll({ factorId: enrolling.factorId });
    setEnrolling(null);
  }

  async function disable() {
    if (!activeId || !window.confirm("Turn off two-factor authentication? Your account will be protected by the password only.")) return;
    setBusy(true);
    setError(null);
    const { error: err } = await createSupabaseBrowserClient().auth.mfa.unenroll({ factorId: activeId });
    if (err) setError("Could not turn it off. Sign out, sign in again with your code, then try once more.");
    else {
      setNotice("Two-factor authentication is off.");
      await load();
    }
    setBusy(false);
  }

  return (
    <Card padding="lg">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-text">Two-factor authentication</h2>
        {loaded && <Badge tone={activeId ? "success" : "neutral"}>{activeId ? "On" : "Off"}</Badge>}
      </div>
      <p className="mt-1 text-sm text-text-3">
        Adds a 6-digit code from an authenticator app (Google Authenticator, Authy, 1Password...) to your sign-in, so a stolen password alone is not enough.
      </p>
      <div className="mt-5 space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}

        {loaded && !activeId && !enrolling && <Button onClick={() => void startEnroll()} loading={busy}>Set up authenticator app</Button>}

        {enrolling && (
          <div className="space-y-3">
            <p className="text-sm text-text-2">1. Scan this QR code with your authenticator app.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enrolling.qr} alt="QR code for your authenticator app" className="h-44 w-44 rounded-lg bg-white p-2" />
            <p className="text-xs text-text-3">Cannot scan? Enter this key in the app instead: <code className="break-all text-text">{enrolling.secret}</code></p>
            <p className="text-sm text-text-2">2. Enter the 6-digit code the app shows.</p>
            <div className="flex flex-wrap gap-2">
              <Input inputMode="numeric" autoComplete="one-time-code" maxLength={10} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" disabled={busy} className="w-40" />
              <Button onClick={() => void confirmEnroll()} loading={busy}>Turn on</Button>
              <Button variant="secondary" onClick={() => void cancelEnroll()} disabled={busy}>Cancel</Button>
            </div>
          </div>
        )}

        {loaded && activeId && !enrolling && (
          <div className="space-y-2">
            <Button variant="danger" onClick={() => void disable()} loading={busy}>Turn off</Button>
            <p className="text-xs text-text-3">Keep your phone safe. If you lose the authenticator app you cannot sign in until support removes it from your account.</p>
          </div>
        )}
      </div>
    </Card>
  );
}
