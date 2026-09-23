// app/dashboard/licenses/page.tsx
// Sprint IA3 - was reading a hardcoded mock array (data/licenses.ts) keyed
// by fake customerId strings ("c1"/"c2"/"c3") that could never match a real
// user's database id - confirmed via types/marketplace-license.ts's own
// header comment (Sprint M11 discovered this exact collision: this page's
// whole license/data/service chain was scaffold code for "the legacy
// /products demo catalog", explicitly never made real when the M11 real
// licensing architecture was built alongside it for the Marketplace). This
// page showed "No licenses yet" to every real customer, always, regardless
// of what they'd actually licensed - the same class of bug as the mock
// Orders page IA2 deleted, just harder to notice since an empty state
// looks plausible instead of obviously broken.
// Now wired to the same real, DB-backed service Purchases already uses
// (services/licensing/myPurchases.ts, Sprint M11/M13) - a license-centric
// view of the same real data Purchases shows in purchase-centric form,
// reusing its existing real detail page rather than duplicating it. The
// entire mock chain (types/license.ts, data/licenses.ts, both mock license
// services, lib/license.ts, config/license.config.ts, 5 mock components,
// the mock detail page) was deleted - confirmed orphaned first.
import Link from "next/link";
import { requireUser } from "@/lib/auth/protectedRoute";
import { getMyPurchases } from "@/services/licensing/myPurchases";
import EmptyState from "@/components/ui/EmptyState";
import ButtonLink from "@/components/ui/ButtonLink";
import PageHeader from "@/components/ui/PageHeader";
import LicenseStatusBadge from "@/components/licensing/LicenseStatusBadge";

// Sprint UI-02.7 - cross-dashboard consistency: hand-rolled <h1> -> PageHeader.
// The card-shaped <Link> grid below stays a hand-rolled rounded-card/
// border-border/bg-ink-2 recipe rather than composing Card - the whole
// element IS the link (entire card clickable), and Card doesn't expose an
// "as Link" mode, so wrapping it would mean either an invalid <a><div></a>-
// style nesting workaround or losing the full-card click target.
export default async function LicensesPage() {
  const sessionUser = await requireUser();
  const purchases = await getMyPurchases(sessionUser.profile.id);
  const licenses = purchases.filter((p) => p.licenseId !== null);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Account" title="My Licenses" description="Every license issued from a real Marketplace purchase." />

      {licenses.length === 0 ? (
        <EmptyState
          title="No licenses yet."
          description="Licenses are issued after purchasing a product on the Marketplace."
          action={<ButtonLink href="/marketplace">Browse Marketplace</ButtonLink>}
        />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {licenses.map((l) => (
            <Link
              key={l.licenseId}
              href={`/dashboard/purchases/${l.licenseId}`}
              className="block rounded-card border border-border bg-ink-2 p-6 transition hover:border-gold"
            >
              <div className="mb-4 flex items-center justify-between">
                <p className="font-semibold text-text">{l.listingTitle}</p>
                <LicenseStatusBadge status={l.licenseStatus} />
              </div>
              <div className="space-y-1 text-sm text-text-2">
                <div>
                  Platform: <span className="text-text">{l.platform ?? "—"}</span>
                </div>
                <div>
                  Purchased: <span className="text-text">{new Date(l.purchasedAt).toLocaleDateString()}</span>
                </div>
              </div>
              <p className="mt-4 text-sm text-gold">View license details →</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
