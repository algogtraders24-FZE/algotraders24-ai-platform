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
// NOWPayments follow-on - a "Pay with Crypto" button appears alongside Buy
// Now only when NOWPayments is actually configured on this deployment
// (checked via the same /billing/payment-config booleans the billing page
// uses - it isn't billing-specific, it just reports provider presence).
import { useEffect, useState } from "react";
import { formatListingPrice } from "@/lib/marketplace";
import type { ListingPricing } from "@/types/marketplace";

export default function PurchaseCTA({ listingId, pricing, releaseId }: { listingId: string; pricing: ListingPricing; releaseId: string | null }) {
  const [loading, setLoading] = useState<"card" | "crypto" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cryptoAvailable, setCryptoAvailable] = useState(false);

  const canPurchase = pricing.model === "one_time" && typeof pricing.amount === "number" && pricing.amount > 0 && !!releaseId;

  useEffect(() => {
    if (!canPurchase) return;
    let active = true;
    fetch("/api/private/billing/payment-config")
      .then((res) => res.json())
      .then((body) => {
        if (active && body?.status === "ok") setCryptoAvailable(!!body.data?.nowPaymentsConfigured);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [canPurchase]);

  async function handleBuy(method: "card" | "crypto") {
    setError(null);
    setLoading(method);
    try {
      const path = method === "card" ? "checkout" : "crypto-invoice";
      const res = await fetch(`/api/private/marketplace/listings/${listingId}/${path}`, { method: "POST" });
      const body = await res.json();
      if (!res.ok || body.status !== "ok") throw new Error(body?.error?.message ?? `Checkout failed (${res.status})`);
      window.location.href = method === "card" ? body.data.url : body.data.invoiceUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed.");
      setLoading(null);
    }
  }

  if (canPurchase) {
    return (
      <div className="rounded-2xl bg-ink-3 border border-border p-6 flex flex-col gap-3">
        <span className="text-2xl font-bold">{formatListingPrice(pricing)}</span>
        <button
          type="button"
          onClick={() => handleBuy("card")}
          disabled={loading !== null}
          className="w-full rounded-xl bg-gold text-ink px-5 py-3 font-semibold transition hover:brightness-110 disabled:opacity-60"
        >
          {loading === "card" ? "Redirecting to checkout…" : "Buy Now"}
        </button>
        {cryptoAvailable && (
          <button
            type="button"
            onClick={() => handleBuy("crypto")}
            disabled={loading !== null}
            className="w-full rounded-xl bg-ink-2 border border-border text-text px-5 py-3 font-semibold transition hover:border-gold disabled:opacity-60"
          >
            {loading === "crypto" ? "Redirecting…" : "Pay with Crypto"}
          </button>
        )}
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
