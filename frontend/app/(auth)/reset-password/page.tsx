// app/(auth)/reset-password/page.tsx
// Sprint R1.0.1 - Reached via /auth/callback?redirectTo=/reset-password
// after the recovery code is exchanged for a session.
// Sprint D1.0 - Retrofitted onto Card/Input/Button/Alert + tokens.
"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  resetPasswordAction,
  type ActionState,
} from "@/app/(auth)/actions/auth.actions";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";

const initialState: ActionState = {};

export default function ResetPasswordPage() {
  const [state, formAction, pending] = useActionState(
    resetPasswordAction,
    initialState
  );

  return (
    <Card padding="lg" raised>
      <h1 className="text-2xl font-semibold text-text">Set a new password</h1>
      <p className="mt-1 text-sm text-text-2">
        Choose a new password for your account.
      </p>

      <form action={formAction} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-text-2">New password</label>
          <Input type="password" name="password" required minLength={8} autoComplete="new-password" className="mt-1" />
          <p className="mt-1 text-xs text-text-3">At least 8 characters.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-text-2">Confirm new password</label>
          <Input type="password" name="confirmPassword" required minLength={8} autoComplete="new-password" className="mt-1" />
        </div>

        {state.error ? (
          <Alert tone="danger">
            {state.error}
            {state.error.toLowerCase().includes("expired") && (
              <>
                {" "}
                <Link href="/forgot-password" className="underline hover:text-text">
                  Request a new link
                </Link>
                .
              </>
            )}
          </Alert>
        ) : null}

        <Button type="submit" loading={pending} fullWidth>
          {pending ? "Updating..." : "Update password"}
        </Button>
      </form>

      <div className="mt-4 text-center text-sm">
        <Link href="/login" className="text-gold hover:text-gold-strong">
          Back to sign in
        </Link>
      </div>
    </Card>
  );
}
