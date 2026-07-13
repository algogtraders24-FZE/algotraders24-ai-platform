// app/(auth)/signup/page.tsx
// Sprint 14C - Signup page wired to signUpAction.
"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUpAction, type ActionState } from "@/app/(auth)/actions/auth.actions";
import GoogleButton from "@/components/auth/GoogleButton";

const initialState: ActionState = {};

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(
    signUpAction,
    initialState
  );

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-8 shadow-xl">
      <h1 className="text-2xl font-semibold text-white">Create your account</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Start with Algotraders24 in seconds.
      </p>

      {state.success ? (
        <div className="mt-6 rounded-lg border border-emerald-800 bg-emerald-950/40 p-4 text-sm text-emerald-300">
          {state.message}
        </div>
      ) : (
        <>
          <GoogleButton />
        <div className="my-4 flex items-center gap-3"><div className="h-px flex-1 bg-neutral-800" /><span className="text-xs text-neutral-500">or</span><div className="h-px flex-1 bg-neutral-800" /></div>
        <form action={formAction} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-300">
              Name
            </label>
            <input
              type="text"
              name="name"
              required
              autoComplete="name"
              className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-emerald-500"
            />
          </div>

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
              minLength={8}
              autoComplete="new-password"
              className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-emerald-500"
            />
            <p className="mt-1 text-xs text-neutral-500">
              At least 8 characters.
            </p>
          </div>

          {state.error ? (
            <p className="text-sm text-red-400">{state.error}</p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {pending ? "Creating account..." : "Create account"}
          </button>
        </form>
        </>
      )}

      <div className="mt-4 text-center text-sm">
        <span className="text-neutral-400">Already have an account? </span>
        <Link href="/login" className="text-emerald-400 hover:text-emerald-300">
          Sign in
        </Link>
      </div>
    </div>
  );
}


