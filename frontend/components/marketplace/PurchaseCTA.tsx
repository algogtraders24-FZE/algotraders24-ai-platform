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
  const [couponInput, setCouponInput] = useState("");
  const [promo, setPromo] = useState<{ code: string; percentOff: number; endsAt: string } | null>(null);
  const [couponMsg, setCouponMsg] = useState<string | null>(null);

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

  async function applyCoupon(raw?: string) {
    const code = (raw ?? couponInput).trim();
    if (!code) return;
    setCouponMsg(null);
    try {
      const res = await fetch(`/api/marketplace/promo?code=${encodeURIComponent(code)}`);
      const body = await res.json();
      if (body?.status === "ok" && body.data?.valid) {
        setPromo({ code: body.data.code, percentOff: body.data.percentOff, endsAt: body.data.endsAt });
        setCouponInput(body.data.code);
        setCouponMsg(null);
      } else {
        setPromo(null);
        setCouponMsg("This promo code is not valid or has expired.");
      }
    } catch {
      setCouponMsg("Could not check the promo code. Try again.");
    }
  }

  // Links like /marketplace/<slug>?promo=DIWALI20 apply the code automatically.
  useEffect(() => {
    if (!canPurchase) return;
    const fromUrl = new URLSearchParams(window.location.search).get("promo");
    if (fromUrl) void applyCoupon(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPurchase]);

  const baseAmount = typeof pricing.amount === "number" ? pricing.amount : null;
  const discounted = promo && baseAmount ? Math.max(0.5, Math.round(baseAmount * (100 - promo.percentOff)) / 100) : null;
  const money = (v: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: (pricing as { currency?: string }).currency ?? "USD" }).format(v);

  async function handleBuy(method: "card" | "crypto") {
    setError(null);
    setLoading(method);
    try {
      const path = method === "card" ? "checkout" : "crypto-invoice";
      const res = await fetch(`/api/private/marketplace/listings/${listingId}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(promo ? { couponCode: promo.code } : {}),
      });
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
        {discounted !== null && baseAmount ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-bold">{money(discounted)}</span>
              <span className="text-base text-text-3 line-through">{formatListingPrice(pricing)}</span>
            </div>
            <span className="text-xs text-gold">
              {promo!.code} applied: {promo!.percentOff}% off until {new Date(promo!.endsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </span>
          </div>
        ) : (
          <span className="text-2xl font-bold">{formatListingPrice(pricing)}</span>
        )}
        <div className="flex gap-2">
          <input
            value={couponInput}
            onChange={(e) => setCouponInput(e.target.value)}
            placeholder="Promo code"
            aria-label="Promo code"
            className="min-w-0 flex-1 rounded-xl bg-ink-2 border border-border px-3 py-2 text-sm uppercase"
          />
          <button type="button" onClick={() => void applyCoupon()} className="rounded-xl bg-ink-2 border border-border px-4 py-2 text-sm font-semibold transition hover:border-gold">
            Apply
          </button>
        </div>
        {couponMsg && <p className="text-xs text-danger">{couponMsg}</p>}
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
