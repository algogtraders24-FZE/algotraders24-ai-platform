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
import { signInAction, type ActionState } from "@/app/(auth)/actions/auth.actions";
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

function OAuthError() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  if (!error) return null;
  return (
    <Alert tone="danger" className="mb-4">
      {OAUTH_ERROR_MESSAGES[error] ?? "Sign-in failed. Please try again."}
    </Alert>
  );
}

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signInAction, initialState);

  return (
    <Card padding="lg" raised>
      <h1 className="text-2xl font-semibold text-text">Welcome back</h1>
      <p className="mt-1 text-sm text-text-2">Sign in to your Algotraders24 account.</p>

      <Suspense fallback={null}>
        <div className="mt-4">
          <OAuthError />
        </div>
      </Suspense>

      <GoogleButton />

      <div className="my-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-text-3">or</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <form action={formAction} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-2">Email</label>
          <Input type="email" name="email" required autoComplete="email" className="mt-1" />
        </div>

        <div>
          <label className="block text-sm font-medium text-text-2">Password</label>
          <Input type="password" name="password" required autoComplete="current-password" className="mt-1" />
        </div>

        {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}

        <Button type="submit" loading={pending} fullWidth>
          {pending ? "Signing in..." : "Sign in"}
        </Button>
      </form>

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
