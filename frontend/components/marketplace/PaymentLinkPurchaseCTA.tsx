"use client";
// components/marketplace/PaymentLinkPurchaseCTA.tsx
// Shareable Payment Links - the Buy button for the /pay/[token] landing
// page. Deliberately a separate small component rather than reusing
// PurchaseCTA.tsx: that component's existing endpoint/response-shape
// quirks (different field names for the card vs crypto response, a
// hardcoded /api/private/marketplace/listings/{id}/{path} URL) are already
// shipped and working on real listing pages - not worth touching for this.
// Same visual language (price + Buy Now + Pay with Crypto), talking to the
// new unified checkout-via-link endpoint instead, which returns the same
// `{ url }` shape for both providers.
import { useEffect, useState } from "react";

export default function PaymentLinkPurchaseCTA({
  token,
  amount,
  currency,
  isLoggedIn,
}: {
  token: string;
  amount: number;
  currency: string;
  isLoggedIn: boolean;
}) {
  const [loading, setLoading] = useState<"stripe" | "nowpayments" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cryptoAvailable, setCryptoAvailable] = useState(false);

  useEffect(() => {
    if (!isLoggedIn) return;
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
  }, [isLoggedIn]);

  async function handleBuy(provider: "stripe" | "nowpayments") {
    setError(null);
    setLoading(provider);
    try {
      const res = await fetch(`/api/private/payment-links/${token}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const body = await res.json();
      if (!res.ok || body.status !== "ok") throw new Error(body?.error?.message ?? `Checkout failed (${res.status})`);
      window.location.href = body.data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed.");
      setLoading(null);
    }
  }

  const price = `${currency} ${amount.toLocaleString()}`;

  if (!isLoggedIn) {
    return (
      <div className="rounded-2xl bg-ink-3 border border-border p-6 flex flex-col gap-3">
        <span className="text-2xl font-bold">{price}</span>
        <a
          href={`/login?redirectTo=${encodeURIComponent(`/pay/${token}`)}`}
          className="w-full rounded-xl bg-gold text-ink px-5 py-3 font-semibold text-center transition hover:brightness-110"
        >
          Log in to continue
        </a>
        <p className="text-xs text-text-3">You'll need an AT24 account to complete this purchase.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-ink-3 border border-border p-6 flex flex-col gap-3">
      <span className="text-2xl font-bold">{price}</span>
      <button
        type="button"
        onClick={() => handleBuy("stripe")}
        disabled={loading !== null}
        className="w-full rounded-xl bg-gold text-ink px-5 py-3 font-semibold transition hover:brightness-110 disabled:opacity-60"
      >
        {loading === "stripe" ? "Redirecting to checkout…" : "Buy Now"}
      </button>
      {cryptoAvailable && (
        <button
          type="button"
          onClick={() => handleBuy("nowpayments")}
          disabled={loading !== null}
          className="w-full rounded-xl bg-ink-2 border border-border text-text px-5 py-3 font-semibold transition hover:border-gold disabled:opacity-60"
        >
          {loading === "nowpayments" ? "Redirecting…" : "Pay with Crypto"}
        </button>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      <p className="text-xs text-text-3">One-time purchase. A signed license is issued to your account after payment, valid for one active device.</p>
    </div>
  );
}
