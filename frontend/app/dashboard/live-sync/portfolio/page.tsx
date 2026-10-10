// app/dashboard/live-sync/portfolio/page.tsx
// "My portfolio": all of the signed-in user's synced accounts in one view (Myfxbook-style Portfolio page). Their own data.
import PageHeader from "@/components/ui/PageHeader";
import ButtonLink from "@/components/ui/ButtonLink";
import PortfolioView from "@/components/live-sync/PortfolioView";

export default function PortfolioPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="INTELLIGENCE"
        title="My portfolio"
        description="All your synced MetaTrader accounts in one table with totals, a growth chart and the period results. This page is private to you."
        action={<ButtonLink href="/dashboard/live-sync" size="sm" variant="secondary">Live Sync</ButtonLink>}
      />
      <PortfolioView />
    </div>
  );
}
