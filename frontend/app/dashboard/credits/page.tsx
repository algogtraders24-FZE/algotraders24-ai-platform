// app/dashboard/credits/page.tsx
// Sprint IA1/IA2 history: originally shipped with no real ledger behind it
// (honest "not yet available" disclosure, correct at the time).
//
// Email audit follow-up (2026-09-24) - that disclosure went stale without
// anyone updating this page: the A9 credit ledger has been live in
// production since 2026-09-07 (services/agent-framework/credits/credit-
// ledger.ts), computing a real, correct per-user balance on every real
// agent-run charge - confirmed via a direct database check (343 real
// ledger entries), not just reading the code. This page's own comment
// previously claimed A9 was "deliberately INERT until its migration is
// applied" - that migration has been applied the whole time; the comment
// was simply never corrected after whatever landed A9 shipped. Now shows
// the real balance instead of a stale "not available" message.
import type { Metadata } from "next";
import Card from "@/components/ui/Card";
import ButtonLink from "@/components/ui/ButtonLink";
import PageHeader from "@/components/ui/PageHeader";
import { CREDIT_ACTION_LABELS } from "@/types/credits";
import { requireUser } from "@/lib/auth/protectedRoute";
import { createCreditLedger } from "@/services/agent-framework/credits";

export const metadata: Metadata = {
  title: "Credits",
};

// Sprint UI-02.7 - cross-dashboard consistency: hand-rolled <h1> -> PageHeader.
export default async function CreditsPage() {
  const sessionUser = await requireUser();
  const balance = await createCreditLedger().balance(sessionUser.profile.id);
  const usedPct = balance.allowance > 0 ? Math.min(100, Math.round((balance.consumed / balance.allowance) * 100)) : 0;
  const periodEnd = new Date(balance.periodEnd).toLocaleDateString(undefined, { month: "long", day: "numeric" });
  const barColor = usedPct >= 100 ? "bg-danger" : usedPct >= 80 ? "bg-warning" : "bg-success";

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader eyebrow="Account" title="Credits" description="Your real AI-credit usage for this billing period." />

      <Card padding="lg">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-text-3">This period</h2>
          <span className="text-xs text-text-3">Resets {periodEnd}</span>
        </div>
        <p className="mt-2 text-2xl font-bold text-text">
          {Math.max(0, Math.round(balance.balance)).toLocaleString()} <span className="text-sm font-normal text-text-3">/ {balance.allowance.toLocaleString()} remaining</span>
        </p>
        <div className="mt-3 h-2 w-full rounded-full bg-ink-3">
          <div className={`h-2 rounded-full ${barColor}`} style={{ width: `${usedPct}%` }} />
        </div>
        <p className="mt-2 text-xs text-text-3">{balance.consumed.toLocaleString()} used ({usedPct}%) on real AI Agent runs and Automations this period.</p>
        <p className="mt-3 text-sm text-text-2">
          This is a real, live count - every AI Agent run and Automation execution charges against it. Deterministic Quant backtesting is not credit-metered.
        </p>
      </Card>

      <Card padding="lg">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-text-3">What's planned</h2>
        <p className="mt-1 text-sm text-text-2">
          Metering itself is live (above) - this is a future, more granular per-action breakdown, listed for transparency, not yet active:
        </p>
        <ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm text-text-2 sm:grid-cols-2">
          {Object.values(CREDIT_ACTION_LABELS).map((label) => (
            <li key={label} className="flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-text-3" aria-hidden="true" />
              {label}
            </li>
          ))}
        </ul>
      </Card>

      <Card padding="lg">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-text-3">Manage access</h2>
            <p className="mt-1 text-sm text-text-2">View or change your plan.</p>
          </div>
          <ButtonLink href="/dashboard/billing" variant="secondary">
            Go to Billing
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}
