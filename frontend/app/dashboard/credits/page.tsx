// app/dashboard/credits/page.tsx
// Sprint IA1 - New page. The ACCOUNT/Credits slot in the locked backoffice
// IA has no built feature behind it yet: no credit ledger, no metering on
// any AI-powered action, no pricing (explicitly deferred by this sprint's
// own scope - "the exact credit prices/amounts are NOT being finalized").
// Rather than fabricate a balance/usage widget with invented numbers, this
// states that status honestly and points at what IS real today (plan-based
// access, managed in Billing) - the same disclosure pattern already used
// by /quant-lite/upgrade for the not-yet-built Quant Pro.
// Sprint IA2 - "give Credits a ready structure for the future AI-credit
// system, without implementing fake metering." The structure is
// types/credits.ts (an inert type skeleton + CREDIT_ACTION_LABELS, nothing
// reads/writes it) plus the roadmap list below, sourced from that same
// labels map - still zero numbers, zero fake balance, just naming what the
// categories will be so a future metering sprint isn't designing from
// scratch.
//
// Beta Production Smoke, Batch 4 (owner-authorized) - this page previously
// said "Credit-based metering...has not been built yet", which read as
// contradicting the real per-run usage already shown on the AI Agents and
// Automation pages. There are two distinct systems: A8's live per-run
// budget counter (real, active, already displayed elsewhere - see
// services/agent-framework/credits/credit-ledger.ts's own header) and A9's
// account-level balance ledger (real, built, but deliberately INERT until
// its migration is applied - see services/agent-framework/credits/
// index.ts). Owner decision: keep A9 inert, correct the copy only to
// distinguish the two rather than imply neither exists.
import type { Metadata } from "next";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import ButtonLink from "@/components/ui/ButtonLink";
import { CREDIT_ACTION_LABELS } from "@/types/credits";

export const metadata: Metadata = {
  title: "Credits",
};

export default function CreditsPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text">Credits</h1>
        <p className="mt-1 text-sm text-text-3">
          AI usage tracking is active for this account. Account-level credit balances are not yet available.
        </p>
      </div>

      <Card padding="lg">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-text-3">Status</h2>
          <Badge tone="neutral">Balance not yet available</Badge>
        </div>
        <p className="mt-3 text-sm text-text-2">
          AI usage tracking is active for this account - actions like AI Agent runs and Automations already record
          and display real usage (see AI Agents and Automation). What&apos;s not yet available is an account-level
          credit balance: pricing and the credit policy have not been finalized, so there is no balance to show
          here. This is not a bug.
        </p>
        <p className="mt-3 text-sm text-text-2">
          Today, access to AI features is governed by your plan, not by an individual credit balance. Deterministic
          Quant backtesting is not credit-metered.
        </p>
      </Card>

      <Card padding="lg">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-text-3">What's planned</h2>
        <p className="mt-1 text-sm text-text-2">
          Actions expected to consume credits once metering ships - listed for transparency, not yet active:
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
