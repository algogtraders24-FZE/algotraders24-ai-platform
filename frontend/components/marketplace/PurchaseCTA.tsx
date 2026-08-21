"use client";
// components/marketplace/PurchaseCTA.tsx
// Sprint M8 - Section 28: no payment integration is implemented in M8, and
// none is faked. Renders an honest "not yet available" state rather than
// a button that pretends to purchase something.
// Sprint M12 branding follow-on - real Stripe checkout, but still gated
// honestly: a Buy button only ever appears when BOTH a valid one_time
// price exists AND `releaseId` is non-null (a real PUBLISHED
// ReleaseArtifact - see MarketplaceCatalogue.findRealRelease). A listing
// can have a $299 price and still show "coming soon" if nothing real
// exists to deliver - never take payment for nothing downloadable.
import { useState } from "react";
import { formatListingPrice } from "@/lib/marketplace";
import type { ListingPricing } from "@/types/marketplace";

export default function PurchaseCTA({ listingId, pricing, releaseId }: { listingId: string; pricing: ListingPricing; releaseId: string | null }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canPurchase = pricing.model === "one_time" && typeof pricing.amount === "number" && pricing.amount > 0 && !!releaseId;

  async function handleBuy() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/private/marketplace/listings/${listingId}/checkout`, { method: "POST" });
      const body = await res.json();
      if (!res.ok || body.status !== "ok") throw new Error(body?.error?.message ?? `Checkout failed (${res.status})`);
      window.location.href = body.data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed.");
      setLoading(false);
    }
  }

  if (canPurchase) {
    return (
      <div className="rounded-2xl bg-ink-3 border border-border p-6 flex flex-col gap-3">
        <span className="text-2xl font-bold">{formatListingPrice(pricing)}</span>
        <button
          type="button"
          onClick={handleBuy}
          disabled={loading}
          className="w-full rounded-xl bg-gold text-ink px-5 py-3 font-semibold transition hover:brightness-110 disabled:opacity-60"
        >
          {loading ? "Redirecting to checkout…" : "Buy Now"}
        </button>
        {error && <p className="text-xs text-danger">{error}</p>}
        <p className="text-xs text-text-3">One-time purchase. A signed license is issued to your account after payment, valid for one active device.</p>
      </div>
    );
  }

  const reason = pricing.model !== "one_time" || pricing.amount == null
    ? "This seller hasn't set a price yet."
    : "The seller hasn't published a downloadable build yet.";

  return (
    <div className="rounded-2xl bg-ink-3 border border-border p-6 flex flex-col gap-3">
      <span className="text-2xl font-bold">{formatListingPrice(pricing)}</span>
      <button
        type="button"
        disabled
        aria-disabled="true"
        className="w-full rounded-xl bg-ink-2 border border-border text-text-3 px-5 py-3 font-semibold cursor-not-allowed"
        title={reason}
      >
        Purchasing coming soon
      </button>
      <p className="text-xs text-text-3">{reason} No payment will be requested or charged.</p>
    </div>
  );
}
