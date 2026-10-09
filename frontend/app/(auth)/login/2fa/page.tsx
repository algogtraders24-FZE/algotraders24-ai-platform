"use client";
// app/(auth)/login/2fa/page.tsx
// Second step of sign-in for accounts with an authenticator app: enter the 6-digit code, then continue to the page the user wanted.
// Reached from proxy.ts (when MFA_ENFORCE=true and the session is still at level aal1).
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { normalizeTotp, safeNext } from "@/lib/auth/mfa";

function TwoFactorForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("redirectTo") ?? params.get("redirect"));
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createSupabaseBrowserClient();
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        router.replace(`/login?redirectTo=${encodeURIComponent(next)}`);
        return;
      }
      const { data, error: err } = await supabase.auth.mfa.listFactors();
      const totp = data?.totp?.[0]; // only VERIFIED factors are listed here
      if (err || !totp) {
        router.replace(next);
        return;
      }
      setFactorId(totp.id);
    })();
  }, [router, next]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const digits = normalizeTotp(code);
    if (!digits || !factorId) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const challenge = await supabase.auth.mfa.challenge({ factorId });
    if (challenge.error) {
      setError("Could not start the check. Please try again.");
      setBusy(false);
      return;
    }
    const verify = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code: digits });
    if (verify.error) {
      setError("That code is not right. Wait for the next code and try again.");
      setBusy(false);
      return;
    }
    // Full navigation so the proxy sees the upgraded (aal2) session cookie.
    window.location.href = next;
  }

  async function signOut() {
    await createSupabaseBrowserClient().auth.signOut();
    window.location.href = "/login";
  }

  return (
    <Card padding="lg">
      <h1 className="text-xl font-semibold text-text">Two-factor authentication</h1>
      <p className="mt-1 text-sm text-text-2">Open your authenticator app and enter the 6-digit code for Algotraders24.</p>
      {error && <Alert tone="danger" className="mt-4">{error}</Alert>}
      <form onSubmit={submit} className="mt-5 space-y-4">
        <Input inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={10} value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" disabled={busy || !factorId} />
        <Button type="submit" fullWidth loading={busy} disabled={!factorId}>Verify</Button>
      </form>
      <button type="button" onClick={() => void signOut()} className="mt-4 text-xs text-text-3 hover:text-text hover:underline">
        Sign out
      </button>
    </Card>
  );
}

export default function TwoFactorPage() {
  return (
    <Suspense fallback={null}>
      <TwoFactorForm />
    </Suspense>
  );
}
