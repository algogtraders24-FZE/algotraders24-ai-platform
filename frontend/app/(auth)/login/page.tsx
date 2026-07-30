// app/(auth)/login/page.tsx
// Sprint 14C - Login page wired to signInAction.
// Sprint R1.0.1 - Now surfaces ?error= from a failed Google OAuth redirect
// (signInWithGoogleAction / /auth/callback both redirect here with a real
// error message on failure) - previously that query param was silently
// dropped and a failed Google sign-in looked like nothing happened at all.
"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { signInAction, type ActionState } from "@/app/(auth)/actions/auth.actions";
import GoogleButton from "@/components/auth/GoogleButton";

const initialState: ActionState = {};

function OAuthError() {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  if (!error) return null;
  return (
    <p className="mb-4 rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-400">
      {error === "auth_callback_failed" ? "Sign-in link was invalid or expired. Please try again." : error}
    </p>
  );
}

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(
    signInAction,
    initialState
  );

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-8 shadow-xl">
      <h1 className="text-2xl font-semibold text-white">Welcome back</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Sign in to your Algotraders24 account.
      </p>

      <Suspense fallback={null}>
        <div className="mt-4">
          <OAuthError />
        </div>
      </Suspense>

      <GoogleButton />

      <div className="my-4 flex items-center gap-3"><div className="h-px flex-1 bg-neutral-800" /><span className="text-xs text-neutral-500">or</span><div className="h-px flex-1 bg-neutral-800" /></div>

      <form action={formAction} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-neutral-300">
            Email
          </label>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-emerald-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-300">
            Password
          </label>
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-emerald-500"
          />
        </div>

        {state.error ? (
          <p className="text-sm text-red-400">{state.error}</p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
        >
          {pending ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <div className="mt-4 flex items-center justify-between text-sm">
        <Link href="/forgot-password" className="text-neutral-400 hover:text-white">
          Forgot password?
        </Link>
        <Link href="/signup" className="text-emerald-400 hover:text-emerald-300">
          Create account
        </Link>
      </div>
    </div>
  );
}
