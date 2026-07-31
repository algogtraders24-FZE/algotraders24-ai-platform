"use client";
// components/auth/ResendVerificationButton.tsx
// Sprint R1.0.1 - Small, self-contained interactive fragment dropped into
// the (server-rendered) dashboard page. Real action: calls
// resendVerificationAction, which resends a genuine Supabase confirmation
// email to the current session's own address.
// Sprint D1.0 - Retrofitted onto the token system (text-emerald-400/
// text-red-400/text-gray-300 -> success/danger/text).
import { useActionState } from "react";
import { resendVerificationAction, type ActionState } from "@/app/(auth)/actions/auth.actions";

const initialState: ActionState = {};

export default function ResendVerificationButton() {
  const [state, formAction, pending] = useActionState(resendVerificationAction, initialState);

  if (state.success) {
    return <span className="text-success">{state.message}</span>;
  }

  return (
    <form action={formAction} className="inline">
      <button
        type="submit"
        disabled={pending}
        className="underline decoration-dotted underline-offset-2 hover:text-text disabled:opacity-50"
      >
        {pending ? "Sending..." : "Resend verification email"}
      </button>
      {state.error && <span className="ml-2 text-danger">{state.error}</span>}
    </form>
  );
}
