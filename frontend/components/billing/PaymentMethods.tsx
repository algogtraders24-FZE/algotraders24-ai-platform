// components/billing/PaymentMethods.tsx
// Sprint 13A — Subscription & Billing Foundation
// Sprint L2.5 - Replaced fabricated payment methods with an honest
// disclosure - no payment provider is connected anywhere in this app.
// Sprint D1.0 - Retrofitted onto Card/EmptyState + tokens.
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";

export default function PaymentMethods() {
  return (
    <Card>
      <div className="mb-5 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-text">Payment Methods</h3>
      </div>

      <EmptyState
        title="No payment methods on file."
        description="Payment provider integration (Stripe / NOWPayments) is not yet connected, so cards and wallets can't be added here today."
      />
    </Card>
  );
}
