// app/(auth)/login/page.tsx
// Sprint 14C - Login page wired to signInAction.
// Sprint R1.0.1 - Surfaces ?error= from a failed Google OAuth redirect.
// Sprint D1.0 - Retrofitted onto Card/Input/Button/Alert + tokens
// (border-neutral-800/bg-neutral-900/bg-emerald-600 -> border/ink-2/gold) -
// previously a visually separate "product" from the homepage/dashboard.
"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { signInAction, resendVerificationForEmailAction, type ActionState } from "@/app/(auth)/actions/auth.actions";
import GoogleButton from "@/components/auth/GoogleButton";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";

const initialState: ActionState = {};

// Sprint R1.1 - Only a fixed set of known codes get a specific message;
// anything else falls back to one generic message rather than rendering
// arbitrary query-param content.
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  auth_callback_failed: "Sign-in link was invalid or expired. Please try again.",
};

function OAuthError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <Alert tone="danger" className="mb-4">
      {OAUTH_ERROR_MESSAGES[error] ?? "Sign-in failed. Please try again."}
    </Alert>
  );
}

// Reads ?redirect= (set by requireUser()/pages that build their own login
// link, e.g. /login?redirect=/marketplace/sell) or ?redirectTo= (set by
// proxy.ts's auth gate, e.g. /login?redirectTo=/dashboard/settings) so a
// successful sign-in sends them back to the page they actually wanted
// instead of always landing on /dashboard. Wrapped in Suspense because
// useSearchParams requires it.
function LoginFormBody() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const redirect = searchParams.get("redirectTo") ?? searchParams.get("redirect");
  const [state, formAction, pending] = useActionState(signInAction, initialState);
  const [resendState, resendAction, resending] = useActionState(resendVerificationForEmailAction, initialState);
  const notVerified = !!state.error && /confirm|verif/i.test(state.error);

  return (
    <>
      <div className="mt-4">
        <OAuthError error={error} />
      </div>

      <GoogleButton redirectTo={redirect ?? undefined} />

      <div className="my-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-text-3">or</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <form action={formAction} className="mt-6 space-y-4">
        <input type="hidden" name="redirect" value={redirect ?? ""} />
        <div>
          <label className="block text-sm font-medium text-text-2">Email</label>
          <Input type="email" name="email" required autoComplete="email" className="mt-1" />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-2">Password</label>
          <Input type="password" name="password" required autoComplete="current-password" className="mt-1" />
        </div>

        {state.error ? <p className="text-sm text-danger">{notVerified ? "Your email address is not verified yet. Open the link we emailed you (check spam too), or send a new one below." : state.error}</p> : null}
        {notVerified && (
          <div className="space-y-2">
            <button type="submit" formAction={resendAction} disabled={resending} className="text-sm text-gold underline underline-offset-2 hover:text-gold-strong disabled:opacity-50">
              {resending ? "Sending..." : "Send a new verification email"}
            </button>
            {resendState.success && resendState.message ? <p className="text-sm text-success">{resendState.message}</p> : null}
            {resendState.error ? <p className="text-sm text-danger">{resendState.error}</p> : null}
          </div>
        )}

        <Button type="submit" loading={pending} fullWidth>
          {pending ? "Signing in..." : "Sign in"}
        </Button>
      </form>
    </>
  );
}

export default function LoginPage() {
  return (
    <Card padding="lg" raised>
      <h1 className="text-2xl font-semibold text-text">Welcome back</h1>
      <p className="mt-1 text-sm text-text-2">Sign in to your Algotraders24 account.</p>

      <Suspense fallback={null}>
        <LoginFormBody />
      </Suspense>

      <div className="mt-4 flex items-center justify-between text-sm">
        <Link href="/forgot-password" className="text-text-3 hover:text-text">
          Forgot password?
        </Link>
        <Link href="/signup" className="text-gold hover:text-gold-strong">
          Create account
        </Link>
      </div>
    </Card>
  );
}
