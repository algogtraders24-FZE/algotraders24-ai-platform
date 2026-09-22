// app/dashboard/purchases/page.tsx
// Sprint M13 (closing the marketplace delivery loop) - real, DB-backed
// list of the current buyer's own Marketplace purchases (Purchase ->
// Entitlement -> License, see services/licensing/myPurchases.ts).
// Sprint IA3 - app/dashboard/licenses is now also wired to this same real
// service (a license-centric view vs. this purchase-centric one) - the
// mock chain that used to live there is gone.
import Link from "next/link";
import { requireUser } from "@/lib/auth/protectedRoute";
import { getMyPurchases } from "@/services/licensing/myPurchases";
import EmptyState from "@/components/ui/EmptyState";
import ButtonLink from "@/components/ui/ButtonLink";
import Card from "@/components/ui/Card";
import LicenseStatusBadge from "@/components/licensing/LicenseStatusBadge";

export default async function MyPurchasesPage() {
  const sessionUser = await requireUser();
  const purchases = await getMyPurchases(sessionUser.profile.id);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text">My Purchases</h1>
        <p className="mt-1 text-sm text-text-2">Every real Marketplace purchase, with its License and EA download.</p>
      </div>

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
                  <Link href={`/dashboard/purchases/${p.licenseId}`} className="rounded-control border border-border px-4 py-2 text-sm font-semibold text-text transition hover:border-gold">
                    View License
                  </Link>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
