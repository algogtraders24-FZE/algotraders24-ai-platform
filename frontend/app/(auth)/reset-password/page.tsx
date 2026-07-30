// app/(auth)/reset-password/page.tsx
// Sprint R1.0.1 - The page that was missing entirely: forgotPasswordAction
// could send a real reset email, but nothing ever collected the new
// password after the user clicked the link. Reached via
// /auth/callback?redirectTo=/reset-password (see AuthService.forgotPassword),
// which exchanges the recovery code for a session before landing here -
// resetPasswordAction then requires that session to actually be active.
"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  resetPasswordAction,
  type ActionState,
} from "@/app/(auth)/actions/auth.actions";

const initialState: ActionState = {};

export default function ResetPasswordPage() {
  const [state, formAction, pending] = useActionState(
    resetPasswordAction,
    initialState
  );

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-8 shadow-xl">
      <h1 className="text-2xl font-semibold text-white">Set a new password</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Choose a new password for your account.
      </p>

      <form action={formAction} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-neutral-300">
            New password
          </label>
          <input
            type="password"
            name="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-emerald-500"
          />
          <p className="mt-1 text-xs text-neutral-500">At least 8 characters.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-300">
            Confirm new password
          </label>
          <input
            type="password"
            name="confirmPassword"
            required
            minLength={8}
            autoComplete="new-password"
            className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-white outline-none focus:border-emerald-500"
          />
        </div>

        {state.error ? (
          <div className="rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-400">
            {state.error}
            {state.error.toLowerCase().includes("expired") && (
              <>
                {" "}
                <Link href="/forgot-password" className="underline hover:text-red-300">
                  Request a new link
                </Link>
                .
              </>
            )}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
        >
          {pending ? "Updating..." : "Update password"}
        </button>
      </form>

      <div className="mt-4 text-center text-sm">
        <Link href="/login" className="text-emerald-400 hover:text-emerald-300">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
