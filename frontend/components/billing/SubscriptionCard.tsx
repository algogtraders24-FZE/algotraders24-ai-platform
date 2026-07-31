"use client";
// components/billing/SubscriptionCard.tsx
// Sprint 13A — Subscription & Billing Foundation
// Sprint L2.5 - Real Cancel/Reactivate action, derived from the real
// cancelAtPeriodEnd column.
// Sprint D1.0 - Retrofitted onto Card/Badge/Button + tokens.
import { useState } from "react";
import type { Subscription } from "@/types/billing";
import {
  PLAN_LABELS,
  PLAN_COLORS,
  SUBSCRIPTION_STATUS_LABELS,
  BILLING_CYCLE_LABELS,
} from "@/config/billing.config";
import { pricingService } from "@/services/billing/PricingService";
import Card from "@/components/ui/Card";
import Badge, { type BadgeTone } from "@/components/ui/Badge";
import Button from "@/components/ui/Button";

interface Props {
  subscription: Subscription;
  onCancel: () => Promise<void>;
  onReactivate: () => Promise<void>;
}

const STATUS_TONE: Record<Subscription["status"], BadgeTone> = {
  active: "success",
  trialing: "info",
  past_due: "warning",
  canceled: "danger",
  paused: "neutral",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border/60 py-3 last:border-0">
      <span className="text-sm text-text-3">{label}</span>
      <span className="text-sm font-medium text-text-2">{children}</span>
    </div>
  );
}

export default function SubscriptionCard({ subscription, onCancel, onReactivate }: Props) {
  const [busy, setBusy] = useState(false);
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
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-text">Subscription Details</h3>
        <Badge tone={STATUS_TONE[subscription.status]}>{SUBSCRIPTION_STATUS_LABELS[subscription.status]}</Badge>
      </div>

      <div className="mb-4 flex items-end gap-2">
        <span
          className="text-2xl font-bold"
          style={{ color: PLAN_COLORS[subscription.planId] }}
        >
          {PLAN_LABELS[subscription.planId]}
        </span>
        <span className="mb-1 text-sm text-text-3">
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
          <span className={subscription.cancelAtPeriodEnd ? "text-warning" : "text-success"}>
            {subscription.cancelAtPeriodEnd ? "Cancels at period end" : "Enabled"}
          </span>
        </Row>
      </div>

      {!isFree && (
        <Button
          onClick={handleClick}
          loading={busy}
          variant={subscription.cancelAtPeriodEnd ? "primary" : "danger"}
          fullWidth
          className="mt-4"
        >
          {busy
            ? "Working..."
            : subscription.cancelAtPeriodEnd
              ? "Reactivate Subscription"
              : "Cancel Subscription"}
        </Button>
      )}
    </Card>
  );
}
