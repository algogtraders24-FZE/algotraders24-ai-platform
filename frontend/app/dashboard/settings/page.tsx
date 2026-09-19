"use client";

// app/dashboard/settings/page.tsx
// Sprint IA1 - New page. The ACCOUNT/Settings slot in the locked backoffice
// IA had no existing destination (a prior sprint, L2.3, explicitly removed
// a "Settings" nav entry because it pointed at a route that didn't exist).
// This is real account information read from the same UserContext every
// other dashboard page uses (no invented fields), plus the real sign-out
// action - not a form of settings that don't yet do anything. Plan/billing
// management is real and already lives at /dashboard/billing, linked below
// rather than duplicated here.
//
// Sprint fix - this page was entirely read-only (name/email/role/status
// display only, no way to actually change anything), which is a genuine
// gap for an "Account Settings" page. Adds the two real, buildable
// settings: editing your display name, and changing your password from an
// active session (see actions.ts's own header comment).
import { useActionState, useState } from "react";
import { useUserContext } from "@/context/UserContext";
import { signOutAction, type ActionState } from "@/app/(auth)/actions/auth.actions";
import { updateNameAction, changePasswordAction } from "./actions";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import ButtonLink from "@/components/ui/ButtonLink";
import Input from "@/components/ui/Input";
import ErrorState from "@/components/ui/ErrorState";
import { PLAN_LABELS } from "@/config/billing.config";
import type { PlanId } from "@/types/billing";

const initialState: ActionState = {};

function NameEditor({ currentName }: { currentName: string }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(updateNameAction, initialState);

  if (state.success && editing) setEditing(false);

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-4">
        <dt className="text-sm text-text-2">Name</dt>
        <dd className="flex items-center gap-3 text-sm text-text">
          {currentName}
          <button type="button" onClick={() => setEditing(true)} className="text-xs font-medium text-gold hover:text-gold-strong">
            Edit
          </button>
        </dd>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-sm text-text-2">Name</dt>
      <dd>
        <form action={formAction} className="flex items-center gap-2">
          <Input name="name" defaultValue={currentName} required maxLength={100} className="h-8 w-40 text-sm" />
          <Button type="submit" size="sm" loading={pending}>
            Save
          </Button>
          <button type="button" onClick={() => setEditing(false)} className="text-xs text-text-3 hover:text-text">
            Cancel
          </button>
        </form>
        {state.error && <p className="mt-1 text-xs text-danger">{state.error}</p>}
      </dd>
    </div>
  );
}

function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePasswordAction, initialState);

  return (
    <Card padding="lg">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-text-3">Change password</h2>
      <form action={formAction} className="mt-4 space-y-3">
        <div>
          <label className="block text-sm text-text-2">New password</label>
          <Input type="password" name="password" required autoComplete="new-password" className="mt-1" />
        </div>
        <div>
          <label className="block text-sm text-text-2">Confirm new password</label>
          <Input type="password" name="confirmPassword" required autoComplete="new-password" className="mt-1" />
        </div>
        {state.error && <p className="text-sm text-danger">{state.error}</p>}
        {state.success && <p className="text-sm text-success">Password changed.</p>}
        <Button type="submit" loading={pending} variant="secondary">
          {pending ? "Changing..." : "Change password"}
        </Button>
      </form>
    </Card>
  );
}

export default function SettingsPage() {
  const { user } = useUserContext();

  // Sprint IA4 - UserContext's `user` arrives synchronously from the server
  // (UserProvider's initialUser, set at mount - see that file's own header
  // comment), so there is no real async "still loading" state to skeleton
  // here; this branch only exists as a defensive guard for a genuinely
  // unexpected state (this page only renders inside app/dashboard/layout.tsx,
  // which already gates on requireUser() before this component can mount).
  // A blank `return null` previously left a silently empty page if that
  // guard was ever somehow hit - now an honest, non-fabricated fallback.
  if (!user) {
    return (
      <div className="max-w-2xl">
        <ErrorState title="Could not load your account details" description="Try reloading the page." />
      </div>
    );
  }

  const planLabel = PLAN_LABELS[user.planId as PlanId] ?? user.planId;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text">Settings</h1>
        <p className="mt-1 text-sm text-text-3">Your account details and sign-in.</p>
      </div>

      <Card padding="lg">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-text-3">Account</h2>
        <dl className="mt-4 space-y-4">
          <NameEditor currentName={user.name} />
          <div className="flex items-center justify-between gap-4">
            <dt className="text-sm text-text-2">Email</dt>
            <dd className="text-sm text-text">{user.email}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-sm text-text-2">Email verified</dt>
            <dd>
              <Badge tone={user.emailVerified ? "success" : "warning"}>
                {user.emailVerified ? "Verified" : "Unverified"}
              </Badge>
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-sm text-text-2">Role</dt>
            <dd className="text-sm capitalize text-text">{user.role}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-sm text-text-2">Account status</dt>
            <dd>
              <Badge tone={user.status === "active" ? "success" : "danger"}>{user.status}</Badge>
            </dd>
          </div>
        </dl>
      </Card>

      <ChangePasswordForm />

      <Card padding="lg">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-text-3">Plan & billing</h2>
            <p className="mt-1 text-sm text-text-2">
              Current plan: <span className="font-medium text-text">{planLabel}</span>
            </p>
          </div>
          <ButtonLink href="/dashboard/billing" variant="secondary">
            Manage billing
          </ButtonLink>
        </div>
      </Card>

      <Card padding="lg">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-text-3">Session</h2>
        <p className="mt-1 text-sm text-text-2">Sign out of your account on this device.</p>
        <div className="mt-4">
          <Button variant="danger" onClick={() => void signOutAction()}>
            Sign out
          </Button>
        </div>
      </Card>
    </div>
  );
}
