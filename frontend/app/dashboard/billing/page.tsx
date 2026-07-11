"use client";
// app/dashboard/billing/page.tsx
// Sprint 13A — Subscription & Billing Foundation

import { useMemo, useState } from "react";
import type { PlanId, PlanChangePreview } from "@/types/billing";
import { billingEngine } from "@/services/billing/BillingEngine";
import { PLAN_LABELS } from "@/config/billing.config";
import { pricingService } from "@/services/billing/PricingService";

import BillingMetrics from "@/components/billing/BillingMetrics";
import UpgradeBanner from "@/components/billing/UpgradeBanner";
import SubscriptionCard from "@/components/billing/SubscriptionCard";
import UsageCard from "@/components/billing/UsageCard";
import PaymentMethods from "@/components/billing/PaymentMethods";
import PricingTable from "@/components/billing/PricingTable";
import PlanComparison from "@/components/billing/PlanComparison";
import InvoiceHistory from "@/components/billing/InvoiceHistory";

export default function BillingPage() {
  const metrics = useMemo(() => billingEngine.getMetrics(), []);
  const subscription = useMemo(() => billingEngine.subscription.get(), []);
  const usageMetrics = useMemo(() => billingEngine.usage.getMetrics(), []);
  const invoices = useMemo(() => billingEngine.getInvoices(), []);
  const plans = useMemo(() => billingEngine.plans.getActive(), []);
  const paymentMethods = useMemo(() => billingEngine.getPaymentMethods(), []);

  const currentPlanId = subscription.planId;
  const upgradeOptions = useMemo(
    () => billingEngine.getUpgradeOptions(),
    []
  );
  const nextPlan = upgradeOptions[0] ?? null;

  const [preview, setPreview] = useState<PlanChangePreview | null>(null);

  const handleSelectPlan = (planId: PlanId) => {
    if (planId === currentPlanId) {
      setPreview(null);
      return;
    }
    setPreview(billingEngine.previewPlanChange(planId));
  };

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <header>
          <h1 className="text-2xl font-bold text-white sm:text-3xl">
            Subscription &amp; Billing
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Manage your plan, usage, invoices, and payment methods.
          </p>
        </header>

        <BillingMetrics metrics={metrics} />

        <UpgradeBanner nextPlan={nextPlan} onUpgrade={handleSelectPlan} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <SubscriptionCard subscription={subscription} />
          <div className="lg:col-span-2">
            <UsageCard metrics={usageMetrics} />
          </div>
        </div>

        <PaymentMethods methods={paymentMethods} />

        <section>
          <div className="mb-5">
            <h2 className="text-xl font-semibold text-white">Plans &amp; Pricing</h2>
            <p className="mt-1 text-sm text-slate-400">
              Compare tiers and choose the plan that fits your workflow.
            </p>
          </div>

          {preview && preview.direction !== "same" && (
            <div className="mb-5 rounded-xl border border-sky-400/30 bg-sky-500/10 p-4 text-sm text-slate-200">
              <span className="font-semibold capitalize">
                {preview.direction}
              </span>{" "}
              from {PLAN_LABELS[preview.fromPlanId]} to{" "}
              <span className="font-semibold">
                {PLAN_LABELS[preview.toPlanId]}
              </span>{" "}
              —{" "}
              {preview.priceDelta >= 0 ? "+" : "-"}
              {pricingService.formatPrice(Math.abs(preview.priceDelta))}/cycle
              {preview.prorationCredit > 0 && (
                <>
                  {" "}
                  · proration credit{" "}
                  {pricingService.formatPrice(preview.prorationCredit)}
                </>
              )}
              . Effective{" "}
              {new Date(preview.effectiveDate).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
              .
              <button
                onClick={() => setPreview(null)}
                className="ml-3 text-xs font-medium text-sky-400 hover:text-sky-300"
              >
                Dismiss
              </button>
            </div>
          )}

          <PricingTable
            plans={plans}
            currentPlanId={currentPlanId}
            onSelectPlan={handleSelectPlan}
          />
        </section>

        <section>
          <h2 className="mb-5 text-xl font-semibold text-white">
            Plan Comparison
          </h2>
          <PlanComparison plans={plans} currentPlanId={currentPlanId} />
        </section>

        <section>
          <InvoiceHistory invoices={invoices} />
        </section>
      </div>
    </div>
  );
}
