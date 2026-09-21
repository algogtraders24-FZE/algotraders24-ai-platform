// components/quant-chat/QuantProUpgradeGate.tsx
// Quant Pro production launch - shown at app/dashboard/quant-chat instead
// of the real Quant Chat UI when the signed-in user has no active paid
// Plan (see lib/access/quant-pro.ts). Links to the existing, already-live
// self-service upgrade flow (app/dashboard/billing - real Stripe Checkout
// and NOWPayments invoice buttons already wired there) rather than
// building a new checkout surface, per the launch's own "reuse existing
// payment-link infrastructure, no new checkout" constraint.
import ButtonLink from "@/components/ui/ButtonLink";

export default function QuantProUpgradeGate() {
  return (
    <div className="flex h-[calc(100vh-2rem)] flex-col items-center justify-center rounded-xl border border-border bg-ink px-6 text-center text-text">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold">Algo Testing Pro</p>
      <h1 className="mt-2 text-xl font-bold">Quant Pro is a paid feature</h1>
      <p className="mt-3 max-w-md text-sm text-text-3">
        Quant Chat's natural-language strategy builder, chart preview, and Run Backtest are part of Quant Pro. Upgrade
        your plan to unlock them.
      </p>
      <ButtonLink href="/dashboard/billing" size="lg" className="mt-6">
        Upgrade plan
      </ButtonLink>
    </div>
  );
}
