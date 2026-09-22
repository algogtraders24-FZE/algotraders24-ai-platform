// app/dashboard/purchases/page.tsx
// Sprint M13 (closing the marketplace delivery loop) - real, DB-backed
// list of the current buyer's own Marketplace purchases (Purchase ->
// Entitlement -> License, see services/licensing/myPurchases.ts).
// Sprint IA3 - app/dashboard/licenses is now also wired to this same real
// service (a license-centric view vs. this purchase-centric one) - the
// mock chain that used to live there is gone.
import { requireUser } from "@/lib/auth/protectedRoute";
import { getMyPurchases } from "@/services/licensing/myPurchases";
import EmptyState from "@/components/ui/EmptyState";
import ButtonLink from "@/components/ui/ButtonLink";
import Card from "@/components/ui/Card";
import PageHeader from "@/components/ui/PageHeader";
import LicenseStatusBadge from "@/components/licensing/LicenseStatusBadge";

// Sprint UI-02.7 - cross-dashboard consistency: hand-rolled <h1> -> PageHeader,
// the manually-styled "View License" <Link> -> ButtonLink (same navigation
// target, just sharing Button's visual classes instead of duplicating them).
export default async function MyPurchasesPage() {
  const sessionUser = await requireUser();
  const purchases = await getMyPurchases(sessionUser.profile.id);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Account" title="My Purchases" description="Every real Marketplace purchase, with its License and EA download." />

      {purchases.length === 0 ? (
        <EmptyState
          title="No purchases yet."
          description="Buy an independently verified trading system on the Marketplace to see it here."
          action={<ButtonLink href="/marketplace">Browse Marketplace</ButtonLink>}
        />
      ) : (
        <div className="space-y-3">
          {purchases.map((p) => (
            <Card key={p.purchaseId} padding="none" className="flex items-center justify-between gap-4 p-5">
              <div>
                <p className="font-semibold text-text">{p.listingTitle}</p>
                <p className="mt-1 text-xs text-text-3">
                  {new Date(p.purchasedAt).toLocaleDateString()} · {p.currency} {p.amount.toLocaleString()} · {p.platform ?? "—"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <LicenseStatusBadge status={p.licenseStatus ?? p.status} />
                {p.licenseId ? (
                  <ButtonLink href={`/dashboard/purchases/${p.licenseId}`} variant="secondary" size="sm">
                    View License
                  </ButtonLink>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
