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
import { useUserContext } from "@/context/UserContext";
import { signOutAction } from "@/app/(auth)/actions/auth.actions";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import ButtonLink from "@/components/ui/ButtonLink";
import { PLAN_LABELS } from "@/config/billing.config";
import type { PlanId } from "@/types/billing";

export default function SettingsPage() {
  const { user } = useUserContext();

  if (!user) return null;

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
          <div className="flex items-center justify-between gap-4">
            <dt className="text-sm text-text-2">Name</dt>
            <dd className="text-sm text-text">{user.name}</dd>
          </div>
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
