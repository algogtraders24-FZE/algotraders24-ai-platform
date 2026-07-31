"use client";
// app/dashboard/billing/page.tsx
// Sprint 13A - Subscription & Billing Foundation
// Sprint 14E - Data now loads from the database via BillingEngine.load().
// Sprint L2.5 - Usage is now real (EntitlementService). Plan changes are
// real for transitions to a $0 plan; anything that would require charging
// the user is rejected server-side (PaymentRequiredClientError) and shown
// as an honest message instead of a fake success. Cancel/Reactivate are
// real, immediate DB writes wired into SubscriptionCard.
// Sprint L2.7 - When Stripe/NOWPayments is actually configured, a paid
// plan change now offers a real "Proceed to Checkout" / "Pay with Crypto"
// action that redirects to the real provider - the honest "not connected"
// message only shows when neither is configured. Also handles the
// `?checkout=success|cancel` redirect Stripe/NOWPayments sends back.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import type { PlanId, PlanChangePreview } from "@/types/billing";
import { billingEngine } from "@/services/billing/BillingEngine";
import { BillingApi, type PaymentConfig } from "@/services/api/BillingApi";
import { AnalyticsApi } from "@/services/api/AnalyticsApi";
import { PLAN_LABELS } from "@/config/billing.config";
import Alert from "@/components/ui/Alert";
import Button from "@/components/ui/Button";
import Skeleton from "@/components/ui/Skeleton";
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
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState<"stripe" | "crypto" | null>(null);
  const [checkoutNotice, setCheckoutNotice] = useState<"success" | "cancel" | null>(null);

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    BillingApi.getPaymentConfig()
      .then(setPaymentConfig)
      .catch(() => setPaymentConfig({ stripeConfigured: false, nowPaymentsConfigured: false }));
  }, []);

  // Sprint L2.7 - real redirect handling: Stripe/NOWPayments send the user
  // back with ?checkout=success|cancel. On success, force-reload billing
  // state (the webhook may have already landed) and clear the query param
  // so a page refresh doesn't re-show the banner.
  useEffect(() => {
    const checkout = searchParams.get("checkout");
    if (checkout === "success" || checkout === "cancel") {
      setCheckoutNotice(checkout);
      if (checkout === "success") setVersion((v) => v + 1);
      router.replace(pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      // Sprint R1.2 - Phase 2: real "subscription_click" event - the single
      // entry point both PricingTable and UpgradeBanner funnel through, so
      // one call here covers every real click, fire-and-forget.
      AnalyticsApi.report("subscription_click", { planId });
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

  const handleCheckout = useCallback(
    async (provider: "stripe" | "crypto") => {
      if (!preview) return;
      setCheckoutBusy(provider);
      setActionMessage(null);
      try {
        const cycle: "monthly" | "yearly" = subscription?.billingCycle ?? "monthly";
        const url =
          provider === "stripe"
            ? await BillingApi.createCheckoutSession(preview.toPlanId, cycle)
            : await BillingApi.createCryptoInvoice(preview.toPlanId, cycle);
        window.location.href = url;
      } catch (err) {
        setActionMessage(err instanceof Error ? err.message : "Could not start checkout.");
        setCheckoutBusy(null);
      }
    },
    [preview, subscription],
  );

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
      <div className="min-h-screen bg-ink px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <Alert tone="danger" title="Could not load billing">
            <p>{error}</p>
            <Button variant="secondary" onClick={retry} className="mt-4">
              Retry
            </Button>
          </Alert>
        </div>
      </div>
    );
  }

  if (!ready || !metrics || !subscription) {
    return (
      <div className="min-h-screen bg-ink px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl space-y-8">
          <header>
            <h1 className="text-2xl font-bold text-text sm:text-3xl">
              Subscription &amp; Billing
            </h1>
            <p className="mt-1 text-sm text-text-2">
              Manage your plan, usage, invoices, and payment methods.
            </p>
          </header>
          <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
          <Skeleton className="h-40" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  const currentPlanId = subscription.planId;
  const nextPlan = upgradeOptions[0] ?? null;

  return (
    <div className="min-h-screen bg-ink px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <header>
          <h1 className="text-2xl font-bold text-text sm:text-3xl">
            Subscription &amp; Billing
          </h1>
          <p className="mt-1 text-sm text-text-2">
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
            <h2 className="text-xl font-semibold text-text">Plans &amp; Pricing</h2>
            <p className="mt-1 text-sm text-text-2">
              Compare tiers and choose the plan that fits your workflow.
            </p>
          </div>

          {checkoutNotice && (
            <Alert tone={checkoutNotice === "success" ? "success" : "info"} className="mb-5">
              {checkoutNotice === "success"
                ? "Checkout completed. Your plan will update once the payment provider confirms the payment (this can take a few seconds)."
                : "Checkout was canceled - no changes were made."}
              <button onClick={() => setCheckoutNotice(null)} className="ml-3 text-xs font-medium underline">
                Dismiss
              </button>
            </Alert>
          )}

          {actionMessage && (
            <Alert tone="danger" className="mb-5">
              {actionMessage}
            </Alert>
          )}

          {preview && preview.direction !== "same" && (
            <div className="mb-5 rounded-card border border-info/30 bg-info/10 p-4 text-sm text-text-2">
              <span className="font-semibold capitalize text-text">{preview.direction}</span> from{" "}
              {PLAN_LABELS[preview.fromPlanId]} to{" "}
              <span className="font-semibold text-text">{PLAN_LABELS[preview.toPlanId]}</span> -{" "}
              {preview.priceDelta >= 0 ? "+" : "-"}
              {pricingService.formatPrice(Math.abs(preview.priceDelta))}/cycle.

              {preview.requiresPayment ? (
                paymentConfig?.stripeConfigured || paymentConfig?.nowPaymentsConfigured ? (
                  <p className="mt-2 text-text-2">
                    This plan requires payment - choose a real payment method below to complete it.
                  </p>
                ) : (
                  <p className="mt-2 text-warning">
                    This change requires payment processing, which isn&apos;t connected yet.
                    Contact support to complete it.
                  </p>
                )
              ) : (
                <p className="mt-2 text-text-2">
                  This plan is free - confirming below switches you over immediately, no payment
                  required.
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-3">
                {!preview.requiresPayment && (
                  <Button size="sm" onClick={handleConfirmChange} loading={actionBusy}>
                    {actionBusy ? "Switching..." : `Confirm switch to ${PLAN_LABELS[preview.toPlanId]}`}
                  </Button>
                )}
                {preview.requiresPayment && paymentConfig?.stripeConfigured && (
                  <Button size="sm" onClick={() => handleCheckout("stripe")} loading={checkoutBusy === "stripe"} disabled={checkoutBusy !== null}>
                    {checkoutBusy === "stripe" ? "Redirecting..." : "Proceed to Checkout (Card)"}
                  </Button>
                )}
                {preview.requiresPayment && paymentConfig?.nowPaymentsConfigured && (
                  <Button size="sm" variant="secondary" onClick={() => handleCheckout("crypto")} loading={checkoutBusy === "crypto"} disabled={checkoutBusy !== null}>
                    {checkoutBusy === "crypto" ? "Redirecting..." : "Pay with Crypto"}
                  </Button>
                )}
                <button
                  onClick={() => setPreview(null)}
                  className="text-xs font-medium text-gold hover:text-gold-strong"
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
          <h2 className="mb-5 text-xl font-semibold text-text">
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
