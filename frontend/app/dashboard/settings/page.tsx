"use client";

// app/dashboard/settings/page.tsx
// Sprint IA1 - New page. The ACCOUNT/Settings slot in the locked backoffice
// IA had no existing destination (a prior sprint, L2.3, explicitly removed
// a "Settings" nav entry because it pointed at a route that didn't exist).
//
// Sprint fix - rebuilt from a single read-only card into a sectioned
// layout (a mini sidebar + real, always-visible edit forms), matching the
// account owner's own request for a more professional settings surface.
// Deliberately only lists sections that have real content behind them
// today (Account, Billing) - no invented "Preferences"/"Privacy"/etc.
// placeholder sections with nothing real in them. More sections get added
// here as real features exist to put in them, not before.
// Sprint UI-02.6 - visual-only pass: this page was already substantially
// on the AT24 system (Card/Badge/Button/ButtonLink/Input/ErrorState in
// use since it was built). Remaining gaps: the hand-rolled <h1>/<p>
// header -> PageHeader, and each section's inline success/error <p> ->
// Alert (its own header comment states its purpose as exactly this -
// "form errors, action results"). Note: /dashboard/billing itself is
// deliberately NOT touched this sprint - PR #111 (BILLING-03) is
// actively modifying it; this page's own small Billing summary card
// (plan label + link-out, a different file) is unaffected and still
// in scope. Same updateNameAction/changePasswordAction/changeEmailAction
// server actions, same real user/plan data, same signOutAction.
import { useActionState, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useUserContext } from "@/context/UserContext";
import { signOutAction, type ActionState } from "@/app/(auth)/actions/auth.actions";
import { updateNameAction, changePasswordAction, changeEmailAction } from "./actions";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import ButtonLink from "@/components/ui/ButtonLink";
import Input from "@/components/ui/Input";
import ErrorState from "@/components/ui/ErrorState";
import Alert from "@/components/ui/Alert";
import PageHeader from "@/components/ui/PageHeader";
import TwoFactorSection from "@/components/settings/TwoFactorSection";
import { PLAN_LABELS } from "@/config/billing.config";
import type { PlanId } from "@/types/billing";

const initialState: ActionState = {};

function SettingsNav() {
  return (
    <nav className="w-full shrink-0 space-y-1 sm:w-44">
      <div className="rounded-control bg-ink-2 px-3 py-2 text-sm font-medium text-text">Account</div>
      <Link href="/dashboard/billing" className="block rounded-control px-3 py-2 text-sm text-text-2 transition-colors hover:bg-ink-2 hover:text-text">
        Billing
      </Link>
    </nav>
  );
}

function SectionCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card padding="lg">
      <h2 className="text-base font-semibold text-text">{title}</h2>
      {description && <p className="mt-1 text-sm text-text-3">{description}</p>}
      <div className="mt-5">{children}</div>
    </Card>
  );
}

interface IdentityView { status: string; message: string; available: boolean; required: boolean }

function SellerVerificationSection({ emailVerified }: { emailVerified: boolean }) {
  const [view, setView] = useState<IdentityView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/private/seller/identity", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.status === "ok") setView(body.data as IdentityView);
    } catch {
      /* the section simply stays without identity details */
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/private/seller/identity", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.status !== "ok") throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      if (body.data.verified) {
        await load();
        setBusy(false);
        return;
      }
      window.location.href = body.data.url as string;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the verification.");
      setBusy(false);
    }
  }

  const status = view?.status ?? "NONE";
  const tone = status === "VERIFIED" ? "success" : status === "REJECTED" ? "danger" : status === "PENDING" || status === "RETRY" ? "warning" : "neutral";
  const label = status === "VERIFIED" ? "Verified" : status === "PENDING" ? "In review" : status === "RETRY" ? "Try again" : status === "REJECTED" ? "Not verified" : "Not verified";
  return (
    <SectionCard title="Seller verification" description="Needed only if you want to sell on the AT24 Marketplace. Buyers see an Identity verified mark on verified sellers.">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-text-2">Email address</p>
          <Badge tone={emailVerified ? "success" : "warning"}>{emailVerified ? "Verified" : "Unverified - confirm the link we emailed you"}</Badge>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-text-2">Identity {view?.required ? "(required to list)" : "(optional for now)"}</p>
          <Badge tone={tone}>{label}</Badge>
        </div>
        {view && <p className="text-xs text-text-3">{view.message}</p>}
        {error && <Alert tone="danger">{error}</Alert>}
        {view?.available && status !== "VERIFIED" && status !== "REJECTED" && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void start()} loading={busy} disabled={!emailVerified}>
              {status === "PENDING" ? "Open the verification again" : status === "RETRY" ? "Try again" : "Verify identity"}
            </Button>
            {status === "PENDING" && <Button variant="secondary" onClick={() => void load()}>Refresh status</Button>}
          </div>
        )}
        {view && !view.available && <p className="text-xs text-text-3">Identity verification is not switched on yet.</p>}
        {!emailVerified && view?.available && <p className="text-xs text-text-3">Confirm your email address first, then you can verify your identity.</p>}
      </div>
    </SectionCard>
  );
}

function ProfileSection({ name }: { name: string }) {
  const [state, formAction, pending] = useActionState(updateNameAction, initialState);

  return (
    <SectionCard title="Profile" description="Your display name, shown across the platform.">
      <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="block text-sm font-medium text-text-2">Name</label>
          <Input name="name" defaultValue={name} required maxLength={100} className="mt-1" />
        </div>
        <Button type="submit" loading={pending} variant="secondary">
          Save
        </Button>
      </form>
      {state.error && <Alert tone="danger" className="mt-3">{state.error}</Alert>}
      {state.success && <Alert tone="success" className="mt-3">{state.message}</Alert>}
    </SectionCard>
  );
}

function EmailSection({ currentEmail, emailVerified }: { currentEmail: string; emailVerified: boolean }) {
  const [state, formAction, pending] = useActionState(changeEmailAction, initialState);

  return (
    <SectionCard title="Email address" description="Changing this sends a confirmation link to your new address - nothing changes until you click it.">
      <div className="mb-4 flex items-center justify-between gap-4 rounded-control border border-border bg-ink-2 px-4 py-3">
        <span className="text-sm text-text">{currentEmail}</span>
        <Badge tone={emailVerified ? "success" : "warning"}>{emailVerified ? "Verified" : "Unverified"}</Badge>
      </div>
      <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label className="block text-sm font-medium text-text-2">New email address</label>
          <Input type="email" name="email" required placeholder="you@example.com" className="mt-1" />
        </div>
        <Button type="submit" loading={pending} variant="secondary">
          Send confirmation
        </Button>
      </form>
      {state.error && <Alert tone="danger" className="mt-3">{state.error}</Alert>}
      {state.success && <Alert tone="success" className="mt-3">{state.message}</Alert>}
    </SectionCard>
  );
}

function PasswordSection() {
  const [state, formAction, pending] = useActionState(changePasswordAction, initialState);

  return (
    <SectionCard title="Password" description="Choose a strong password you don't use anywhere else.">
      <form action={formAction} className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-medium text-text-2">New password</label>
          <Input type="password" name="password" required autoComplete="new-password" className="mt-1" />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-2">Confirm new password</label>
          <Input type="password" name="confirmPassword" required autoComplete="new-password" className="mt-1" />
        </div>
        <div className="sm:col-span-2">
          {state.error && <Alert tone="danger" className="mb-3">{state.error}</Alert>}
          {state.success && <Alert tone="success" className="mb-3">{state.message}</Alert>}
          <Button type="submit" loading={pending} variant="secondary">
            Change password
          </Button>
        </div>
      </form>
    </SectionCard>
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
  if (!user) {
    return (
      <div className="max-w-3xl">
        <ErrorState title="Could not load your account details" description="Try reloading the page." />
      </div>
    );
  }

  const planLabel = PLAN_LABELS[user.planId as PlanId] ?? user.planId;

  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="Account" title="Settings" description="Manage your account, security, and billing." className="mb-6" />

      <div className="flex flex-col gap-8 sm:flex-row">
        <SettingsNav />

        <div className="min-w-0 flex-1 space-y-6">
          <div className="flex flex-wrap items-center gap-2 text-xs text-text-3">
            <span>Role: <span className="capitalize text-text-2">{user.role}</span></span>
            <span aria-hidden="true">&middot;</span>
            <span>Plan: <span className="text-text-2">{planLabel}</span></span>
            <span aria-hidden="true">&middot;</span>
            <Badge tone={user.status === "active" ? "success" : "danger"}>{user.status}</Badge>
          </div>

          <ProfileSection name={user.name} />
          <EmailSection currentEmail={user.email} emailVerified={user.emailVerified} />
          <SellerVerificationSection emailVerified={user.emailVerified} />
          <PasswordSection />
          <TwoFactorSection />

          <SectionCard title="Billing">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-text-2">
                Current plan: <span className="font-medium text-text">{planLabel}</span>
              </p>
              <ButtonLink href="/dashboard/billing" variant="secondary">
                Manage billing
              </ButtonLink>
            </div>
          </SectionCard>

          <SectionCard title="Session" description="Sign out of your account on this device.">
            <Button variant="danger" onClick={() => void signOutAction()}>
              Sign out
            </Button>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
