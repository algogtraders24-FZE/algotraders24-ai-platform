// app/(auth)/forgot-password/page.tsx
// Sprint 14C - Forgot password page wired to forgotPasswordAction.
"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  forgotPasswordAction,
  type ActionState,
} from "@/app/(auth)/actions/auth.actions";

const initialState: ActionState = {};

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(
    forgotPasswordAction,
    initialState
  );

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-8 shadow-xl">
      <h1 className="text-2xl font-semibold text-white">Reset password</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Enter your email and we&apos;ll send you a reset link.
      </p>

      {state.success ? (
        <div className="mt-6 rounded-lg border border-emerald-800 bg-emerald-950/40 p-4 text-sm text-emerald-300">
          {state.message}
        </div>
      ) : (
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

          {state.error ? (
            <p className="text-sm text-red-400">{state.error}</p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {pending ? "Sending..." : "Send reset link"}
          </button>
        </form>
      )}

      <div className="mt-4 text-center text-sm">
        <Link href="/login" className="text-emerald-400 hover:text-emerald-300">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
