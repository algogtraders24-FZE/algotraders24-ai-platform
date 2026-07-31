// app/(auth)/forgot-password/page.tsx
// Sprint 14C - Forgot password page wired to forgotPasswordAction.
// Sprint D1.0 - Retrofitted onto Card/Input/Button/Alert + tokens.
"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  forgotPasswordAction,
  type ActionState,
} from "@/app/(auth)/actions/auth.actions";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";

const initialState: ActionState = {};

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState(
    forgotPasswordAction,
    initialState
  );

  return (
    <Card padding="lg" raised>
      <h1 className="text-2xl font-semibold text-text">Reset password</h1>
      <p className="mt-1 text-sm text-text-2">
        Enter your email and we&apos;ll send you a reset link.
      </p>

      {state.success ? (
        <Alert tone="success" className="mt-6">
          {state.message}
        </Alert>
      ) : (
        <form action={formAction} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-2">Email</label>
            <Input type="email" name="email" required autoComplete="email" className="mt-1" />
          </div>

          {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}

          <Button type="submit" loading={pending} fullWidth>
            {pending ? "Sending..." : "Send reset link"}
          </Button>
        </form>
      )}

      <div className="mt-4 text-center text-sm">
        <Link href="/login" className="text-gold hover:text-gold-strong">
          Back to sign in
        </Link>
      </div>
    </Card>
  );
}
