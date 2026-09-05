// app/dashboard/credits/page.tsx
// Sprint IA1 - New page. The ACCOUNT/Credits slot in the locked backoffice
// IA has no built feature behind it yet: no credit ledger, no metering on
// any AI-powered action, no pricing (explicitly deferred by this sprint's
// own scope - "the exact credit prices/amounts are NOT being finalized").
// Rather than fabricate a balance/usage widget with invented numbers, this
// states that status honestly and points at what IS real today (plan-based
// access, managed in Billing) - the same disclosure pattern already used
// by /quant-lite/upgrade for the not-yet-built Quant Pro.
import type { Metadata } from "next";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import ButtonLink from "@/components/ui/ButtonLink";

export const metadata: Metadata = {
  title: "Credits",
};

export default function CreditsPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text">Credits</h1>
        <p className="mt-1 text-sm text-text-3">AI usage metering for this account.</p>
      </div>

      <Card padding="lg">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-text-3">Status</h2>
          <Badge tone="neutral">Not yet available</Badge>
        </div>
        <p className="mt-3 text-sm text-text-2">
          Credit-based metering for AI features (strategy generation, AI research, agents, and similar
          large-context AI operations) has not been built yet - there is no balance to show here. This is not a
          bug: pricing and the credit policy have not been finalized.
        </p>
        <p className="mt-3 text-sm text-text-2">
          Today, access to AI features is governed by your plan, not by individual credits. Deterministic Quant
          backtesting is not credit-metered.
        </p>
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
