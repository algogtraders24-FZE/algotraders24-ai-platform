"use client";
// app/dashboard/billing/page.tsx
// Sprint 13A - Subscription & Billing Foundation
// Sprint 14E - Data now loads from the database via BillingEngine.load().
// Markup, components, layout and styling are unchanged; only the data source
// and the loading/error handling around it are new.

import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [preview, setPreview] = useState<PlanChangePreview | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setError(null);
    if (reloadKey > 0) setReady(false);

    billingEngine
      .load({ signal: controller.signal, force: reloadKey > 0 })
      .then(() => {
        if (active) setReady(true);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(
          err instanceof Error ? err.message : "Unable to load billing data."
        );
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  const metrics = useMemo(
    () => (ready ? billingEngine.getMetrics() : null),
    [ready]
  );
  const subscription = useMemo(
    () => (ready ? billingEngine.subscription.get() : null),
    [ready]
  );
  const usageMetrics = useMemo(
    () => (ready ? billingEngine.usage.getMetrics() : []),
    [ready]
  );
  const invoices = useMemo(
    () => (ready ? billingEngine.getInvoices() : []),
    [ready]
  );
  const plans = useMemo(
    () => (ready ? billingEngine.plans.getActive() : []),
    [ready]
  );
  const paymentMethods = useMemo(
    () => (ready ? billingEngine.getPaymentMethods() : []),
    [ready]
  );
  const upgradeOptions = useMemo(
    () => (ready ? billingEngine.getUpgradeOptions() : []),
    [ready]
  );

  const handleSelectPlan = useCallback(
    (planId: PlanId) => {
      if (!subscription || planId === subscription.planId) {
        setPreview(null);
        return;
      }
      setPreview(billingEngine.previewPlanChange(planId));
    },
    [subscription]
  );

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-6 text-sm text-slate-200">
            <p className="font-semibold text-red-300">Could not load billing</p>
            <p className="mt-1 text-slate-400">{error}</p>
            <button
              onClick={retry}
              className="mt-4 rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!ready || !metrics || !subscription) {
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
          <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-xl border border-slate-800 bg-slate-900"
              />
            ))}
          </div>
          <div className="h-40 animate-pulse rounded-xl border border-slate-800 bg-slate-900" />
          <div className="h-64 animate-pulse rounded-xl border border-slate-800 bg-slate-900" />
        </div>
      </div>
    );
  }

  const currentPlanId = subscription.planId;
  const nextPlan = upgradeOptions[0] ?? null;

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
              -{" "}
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