// app/(auth)/signup/page.tsx
// Sprint 14C - Signup page wired to signUpAction.
// Sprint D1.0 - Retrofitted onto Card/Input/Button/Alert + tokens.
"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signUpAction, type ActionState } from "@/app/(auth)/actions/auth.actions";
import GoogleButton from "@/components/auth/GoogleButton";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import ButtonLink from "@/components/ui/ButtonLink";
import Alert from "@/components/ui/Alert";

const initialState: ActionState = {};

export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signUpAction, initialState);

  return (
    <Card padding="lg" raised>
      <h1 className="text-2xl font-semibold text-text">Create your account</h1>
      <p className="mt-1 text-sm text-text-2">Start with Algotraders24 in seconds.</p>

      {state.success ? (
        <Alert tone="success" className="mt-6">
          <p className="font-semibold text-success">Check your inbox</p>
          <p className="mt-1">{state.message}</p>
          <ButtonLink href="/login" className="mt-4">
            Go to sign in
          </ButtonLink>
        </Alert>
      ) : (
        <>
          <GoogleButton />
          <div className="my-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-text-3">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>
          <form action={formAction} className="mt-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-2">Name</label>
              <Input type="text" name="name" required autoComplete="name" className="mt-1" />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-2">Email</label>
              <Input type="email" name="email" required autoComplete="email" className="mt-1" />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-2">Password</label>
              <Input type="password" name="password" required minLength={8} autoComplete="new-password" className="mt-1" />
              <p className="mt-1 text-xs text-text-3">At least 8 characters.</p>
            </div>

            {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}

            <Button type="submit" loading={pending} fullWidth>
              {pending ? "Creating account..." : "Create account"}
            </Button>
          </form>
        </>
      )}

      <div className="mt-4 text-center text-sm">
        <span className="text-text-2">Already have an account? </span>
        <Link href="/login" className="text-gold hover:text-gold-strong">
          Sign in
        </Link>
      </div>
    </Card>
  );
}
