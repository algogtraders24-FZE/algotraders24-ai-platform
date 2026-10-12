// app/dashboard/algo-contracts/guide/page.tsx
// The Algo Contracts user guide. Same gate as the main page (only accounts the program is open for). The text comes from
// lib/rewards/guide.ts, the same source as the purchase email, so the two can never disagree.
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import ButtonLink from "@/components/ui/ButtonLink";
import { requireUser } from "@/lib/auth/protectedRoute";
import { rewardsOpenFor } from "@/lib/rewards/access";
import { GUIDE_FAQ, GUIDE_SECTIONS } from "@/lib/rewards/guide";

export const dynamic = "force-dynamic";

export default async function AlgoContractsGuidePage() {
  const sessionUser = await requireUser();
  if (!rewardsOpenFor(sessionUser.profile.email)) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Pro members" title="Algo Contracts guide" description="How Algo Contracts work." />
        <EmptyState title="Not open for your account yet" description="We will let you know when Algo Contracts opens." />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Pro members"
        title="Algo Contracts guide"
        description="Everything about your contract, rebate, withdrawals and referral link in one place."
        action={<ButtonLink href="/dashboard/algo-contracts" variant="secondary" size="sm">Back to Algo Contracts</ButtonLink>}
      />

      <nav aria-label="Guide sections" className="flex flex-wrap gap-2">
        {GUIDE_SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="rounded-control border border-border px-3 py-1 text-xs text-text-2 hover:border-gold/50 hover:text-text">{s.title}</a>
        ))}
        <a href="#faq" className="rounded-control border border-border px-3 py-1 text-xs text-text-2 hover:border-gold/50 hover:text-text">Questions</a>
      </nav>

      {GUIDE_SECTIONS.map((s) => (
        <Card key={s.id} id={s.id} className="space-y-2 scroll-mt-24">
          <h2 className="text-lg font-semibold text-text">{s.title}</h2>
          {s.body.map((p, i) => <p key={i} className="text-sm text-text-2">{p}</p>)}
        </Card>
      ))}

      <Card id="faq" className="space-y-4 scroll-mt-24">
        <h2 className="text-lg font-semibold text-text">Common questions</h2>
        {GUIDE_FAQ.map((f) => (
          <div key={f.q}>
            <h3 className="text-sm font-semibold text-text">{f.q}</h3>
            <p className="text-sm text-text-2">{f.a}</p>
          </div>
        ))}
        <p className="text-xs text-text-3">Still stuck? Write to support@algotraders24.ai with your contract id.</p>
      </Card>
    </div>
  );
}
