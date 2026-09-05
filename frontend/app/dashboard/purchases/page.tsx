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
import Badge from "@/components/ui/Badge";
import ButtonLink from "@/components/ui/ButtonLink";

function licenseStatusTone(status: string | null) {
  if (status === "ACTIVE") return "success" as const;
  if (status === "REVOKED" || status === "EXPIRED") return "danger" as const;
  if (status === "SUSPENDED") return "warning" as const;
  return "neutral" as const;
}

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
            <div key={p.purchaseId} className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-ink-3 p-5">
              <div>
                <p className="font-semibold text-text">{p.listingTitle}</p>
                <p className="mt-1 text-xs text-text-3">
                  {new Date(p.purchasedAt).toLocaleDateString()} · {p.currency} {p.amount.toLocaleString()} · {p.platform ?? "—"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={licenseStatusTone(p.licenseStatus)}>{p.licenseStatus ?? p.status}</Badge>
                {p.licenseId ? (
                  <Link href={`/dashboard/purchases/${p.licenseId}`} className="rounded-control border border-border px-4 py-2 text-sm font-semibold text-text transition hover:border-gold">
                    View License
                  </Link>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
