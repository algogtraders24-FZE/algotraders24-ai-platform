// components/billing/PaymentMethods.tsx
// Sprint 13A — Subscription & Billing Foundation
// Sprint L2.5 - This card previously showed a fabricated Visa card and a
// fabricated USDT wallet as if the user had genuinely saved them - no
// payment provider is connected anywhere in this app (see the L2.5 audit),
// so that was fabricated financial data presented as real. Replaced with
// an honest disclosure instead of removing the section outright, so the
// gap is visible rather than silently hidden.
export default function PaymentMethods() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
      <div className="mb-5 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Payment Methods</h3>
      </div>

      <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-center">
        <p className="text-sm text-slate-400">No payment methods on file.</p>
        <p className="mt-1 text-xs text-slate-600">
          Payment provider integration (Stripe / NOWPayments) is not yet connected, so cards and
          wallets can&apos;t be added here today.
        </p>
      </div>
    </div>
  );
}
