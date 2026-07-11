"use client";
// components/billing/SubscriptionCard.tsx
// Sprint 13A — Subscription & Billing Foundation

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

export default function SubscriptionCard({ subscription }: Props) {
  const statusColor = SUBSCRIPTION_STATUS_COLORS[subscription.status];

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
              subscription.autoRenew ? "text-emerald-400" : "text-slate-500"
            }
          >
            {subscription.autoRenew ? "Enabled" : "Disabled"}
          </span>
        </Row>
        <Row label="Provider">
          <span className="capitalize">{subscription.provider}</span>
        </Row>
      </div>
    </div>
  );
}
