"use client";
// app/dashboard/billing/page.tsx
// Sprint 13A - Subscription & Billing Foundation
// Sprint 14E - Data now loads from the database via BillingEngine.load().
// Sprint L2.5 - Usage is now real (EntitlementService). Plan changes are
// real for transitions to a $0 plan; anything that would require charging
// the user is rejected server-side (PaymentRequiredClientError) and shown
// as an honest message instead of a fake success. Cancel/Reactivate are
// real, immediate DB writes wired into SubscriptionCard.

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
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [preview, setPreview] = useState<PlanChangePreview | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

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

  // Sprint L2.5 - `version` intentionally isn't read inside these callbacks;
  // it exists purely to invalidate memoization after a real mutation
  // (cancel/reactivate/change-plan) updates billingEngine's internal state
  // without a full page reload. Referencing it satisfies exhaustive-deps
  // without pretending the callback body depends on its value.
  const metrics = useMemo(() => {
    void version;
    return ready ? billingEngine.getMetrics() : null;
  }, [ready, version]);
  const subscription = useMemo(() => {
    void version;
    return ready ? billingEngine.subscription.get() : null;
  }, [ready, version]);
  const usageMetrics = useMemo(() => {
    void version;
    return ready ? billingEngine.usage.getMetrics() : [];
  }, [ready, version]);
  const invoices = useMemo(() => {
    void version;
    return ready ? billingEngine.getInvoices() : [];
  }, [ready, version]);
  const plans = useMemo(() => {
    void version;
    return ready ? billingEngine.plans.getActive() : [];
  }, [ready, version]);
  const upgradeOptions = useMemo(() => {
    void version;
    return ready ? billingEngine.getUpgradeOptions() : [];
  }, [ready, version]);

  const handleSelectPlan = useCallback(
    (planId: PlanId) => {
      setActionMessage(null);
      if (!subscription || planId === subscription.planId) {
        setPreview(null);
        return;
      }
      setPreview(billingEngine.previewPlanChange(planId));
    },
    [subscription]
  );

  const handleConfirmChange = useCallback(async () => {
    if (!preview || preview.requiresPayment) return;
    setActionBusy(true);
    setActionMessage(null);
    try {
      await billingEngine.changePlan(preview.toPlanId);
      setPreview(null);
      setVersion((v) => v + 1);
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Could not change plan.");
    } finally {
      setActionBusy(false);
    }
  }, [preview]);

  const handleCancel = useCallback(async () => {
    setActionMessage(null);
    try {
      await billingEngine.cancelSubscription();
      setVersion((v) => v + 1);
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Could not cancel subscription.");
    }
  }, []);

  const handleReactivate = useCallback(async () => {
    setActionMessage(null);
    try {
      await billingEngine.reactivateSubscription();
      setVersion((v) => v + 1);
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Could not reactivate subscription.");
    }
  }, []);

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
          <SubscriptionCard
            subscription={subscription}
            onCancel={handleCancel}
            onReactivate={handleReactivate}
          />
          <div className="lg:col-span-2">
            <UsageCard metrics={usageMetrics} />
          </div>
        </div>

        <PaymentMethods />

        <section>
          <div className="mb-5">
            <h2 className="text-xl font-semibold text-white">Plans &amp; Pricing</h2>
            <p className="mt-1 text-sm text-slate-400">
              Compare tiers and choose the plan that fits your workflow.
            </p>
          </div>

          {actionMessage && (
            <div className="mb-5 rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200">
              {actionMessage}
            </div>
          )}

          {preview && preview.direction !== "same" && (
            <div className="mb-5 rounded-xl border border-sky-400/30 bg-sky-500/10 p-4 text-sm text-slate-200">
              <span className="font-semibold capitalize">{preview.direction}</span> from{" "}
              {PLAN_LABELS[preview.fromPlanId]} to{" "}
              <span className="font-semibold">{PLAN_LABELS[preview.toPlanId]}</span> -{" "}
              {preview.priceDelta >= 0 ? "+" : "-"}
              {pricingService.formatPrice(Math.abs(preview.priceDelta))}/cycle.

              {preview.requiresPayment ? (
                <p className="mt-2 text-amber-300">
                  This change requires payment processing, which isn&apos;t connected yet.
                  Contact support to complete it.
                </p>
              ) : (
                <p className="mt-2 text-slate-300">
                  This plan is free - confirming below switches you over immediately, no payment
                  required.
                </p>
              )}

              <div className="mt-3 flex items-center gap-3">
                {!preview.requiresPayment && (
                  <button
                    onClick={handleConfirmChange}
                    disabled={actionBusy}
                    className="rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-sky-400 disabled:opacity-50"
                  >
                    {actionBusy ? "Switching..." : `Confirm switch to ${PLAN_LABELS[preview.toPlanId]}`}
                  </button>
                )}
                <button
                  onClick={() => setPreview(null)}
                  className="text-xs font-medium text-sky-400 hover:text-sky-300"
                >
                  Dismiss
                </button>
              </div>
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
