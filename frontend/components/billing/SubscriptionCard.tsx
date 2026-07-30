"use client";
// components/billing/SubscriptionCard.tsx
// Sprint 13A — Subscription & Billing Foundation
// Sprint L2.5 - Removed the fabricated "Provider: Mock" row (no payment
// provider is connected - see the L2.5 audit). Auto-Renew is now derived
// directly from the real `cancelAtPeriodEnd` column instead of a
// provider-specific flag that never existed. Added a real Cancel/Reactivate
// action - the only subscription change this app can make honestly without
// a payment processor (see SubscriptionActionService for why plan upgrades
// aren't offered here).

import { useState } from "react";
import type { Subscription } from "@/types/billing";
import {
  PLAN_LABELS,
  PLAN_COLORS,
  SUBSCRIPTION_STATUS_LABELS,
  SUBSCRIPTION_STATUS_COLORS,
  BILLING_CYCLE_LABELS,
} from "@/config/billing.config";
import { pricingService } from "@/services/billing/PricingService";

interface Props {
  subscription: Subscription;
  onCancel: () => Promise<void>;
  onReactivate: () => Promise<void>;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-white/5 py-3 last:border-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-sm font-medium text-slate-200">{children}</span>
    </div>
  );
}

export default function SubscriptionCard({ subscription, onCancel, onReactivate }: Props) {
  const [busy, setBusy] = useState(false);
  const statusColor = SUBSCRIPTION_STATUS_COLORS[subscription.status];
  const isFree = subscription.planId === "free";

  const handleClick = async () => {
    setBusy(true);
    try {
      await (subscription.cancelAtPeriodEnd ? onReactivate() : onCancel());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Subscription Details</h3>
        <span
          className="rounded-full px-3 py-1 text-xs font-semibold"
          style={{ backgroundColor: statusColor + "22", color: statusColor }}
        >
          {SUBSCRIPTION_STATUS_LABELS[subscription.status]}
        </span>
      </div>

      <div className="mb-4 flex items-end gap-2">
        <span
          className="text-2xl font-bold"
          style={{ color: PLAN_COLORS[subscription.planId] }}
        >
          {PLAN_LABELS[subscription.planId]}
        </span>
        <span className="mb-1 text-sm text-slate-500">
          {pricingService.formatPrice(subscription.currentPrice)} /{" "}
          {subscription.billingCycle === "monthly" ? "mo" : "yr"}
        </span>
      </div>

      <div>
        <Row label="Billing Cycle">
          {BILLING_CYCLE_LABELS[subscription.billingCycle]}
        </Row>
        <Row label="Started">{formatDate(subscription.startedAt)}</Row>
        <Row label="Renews On">{formatDate(subscription.renewalDate)}</Row>
        <Row label="Auto-Renew">
          <span
            className={
              subscription.cancelAtPeriodEnd ? "text-amber-400" : "text-emerald-400"
            }
          >
            {subscription.cancelAtPeriodEnd ? "Cancels at period end" : "Enabled"}
          </span>
        </Row>
      </div>

      {!isFree && (
        <button
          onClick={handleClick}
          disabled={busy}
          className={`mt-4 w-full rounded-xl border px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${
            subscription.cancelAtPeriodEnd
              ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
              : "border-white/10 bg-white/5 text-slate-300 hover:border-red-400/30 hover:bg-red-500/10 hover:text-red-300"
          }`}
        >
          {busy
            ? "Working..."
            : subscription.cancelAtPeriodEnd
              ? "Reactivate Subscription"
              : "Cancel Subscription"}
        </button>
      )}
    </div>
  );
}
