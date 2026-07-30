// services/billing/BillingEngine.ts
// Sprint 13A - Top-level orchestrator that composes all billing services.
// Sprint 14E - Plans, subscription and invoices are now loaded from the
// database via /api/private/*. Call load() once before reading; every other
// method stays synchronous, so consuming components are unchanged.
//
// Sprint L2.5 - Usage is now real too (EntitlementService, fetched via
// /api/private/billing/usage). Discounts and payment methods are removed
// entirely rather than left mock: neither was ever backed by a real
// provider or database table, so displaying them was fabricated data, not
// an unfinished feature worth a placeholder for. Added real subscription
// actions (cancel/reactivate/changePlan) that call the server and refresh
// local state - see SubscriptionActionService for what "real" means for
// each (cancel/reactivate always persist; a plan change only persists when
// the target plan is $0 - anything else throws so the UI can show an
// honest "payment required" message instead of a fake success).
import type {
  Plan,
  PlanId,
  Subscription,
  Invoice,
  BillingMetrics,
  PlanChangePreview,
} from "@/types/billing";
import { planService, PlanService } from "./PlanService";
import { pricingService, PricingService } from "./PricingService";
import { subscriptionManager, SubscriptionManager } from "./SubscriptionManager";
import { invoiceService, InvoiceService } from "./InvoiceService";
import { usageService, UsageService } from "./UsageService";
import { BillingApi } from "@/services/api/BillingApi";
import { toPlans } from "./adapters/planAdapter";
import { toInvoices } from "./adapters/invoiceAdapter";
import {
  toSubscription,
  fallbackSubscription,
} from "./adapters/subscriptionAdapter";
import { isPlanId } from "@/config/plan-limits";
import { ApiClientError } from "@/services/api/ApiClient";

export class PaymentRequiredClientError extends Error {}

export class BillingEngine {
  plans: PlanService;
  pricing: PricingService;
  subscription: SubscriptionManager;
  invoices: InvoiceService;
  usage: UsageService;

  private loaded = false;
  private inFlight: Promise<void> | null = null;

  constructor() {
    this.plans = planService;
    this.pricing = pricingService;
    this.subscription = subscriptionManager;
    this.invoices = invoiceService;
    this.usage = usageService;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  // Loads live billing state and hydrates the underlying services.
  // Concurrent callers share a single in-flight request.
  async load(options: { signal?: AbortSignal; force?: boolean } = {}): Promise<void> {
    if (this.loaded && !options.force) return;
    if (this.inFlight && !options.force) return this.inFlight;

    if (options.force) {
      BillingApi.invalidate();
    }

    this.inFlight = this.fetchAndHydrate(options.signal);
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  private async fetchAndHydrate(signal?: AbortSignal): Promise<void> {
    const [apiPlans, apiRecords, subEnvelope, entitlements] = await Promise.all([
      BillingApi.listPlans({ signal }),
      BillingApi.listBillingRecords({ signal }),
      BillingApi.getSubscription({ signal }),
      BillingApi.getUsage({ signal }),
    ]);

    const plans = toPlans(apiPlans);
    this.plans.hydrate(plans);
    this.usage.hydrate(entitlements);

    const userId = subEnvelope.subscription?.userId ?? "";
    this.invoices.hydrate(toInvoices(apiRecords, userId));

    if (subEnvelope.subscription) {
      const planId = subEnvelope.subscription.planId;
      const monthly =
        plans.find((p) => p.id === planId)?.priceMonthly ?? 0;
      this.subscription.hydrate(
        toSubscription(subEnvelope.subscription, monthly)
      );
    } else {
      const planId: PlanId = isPlanId(subEnvelope.planId)
        ? subEnvelope.planId
        : "free";
      this.subscription.hydrate(fallbackSubscription(userId, planId));
    }

    this.loaded = true;
  }

  getCurrentPlan(): Plan | null {
    return this.plans.getById(this.subscription.getCurrentPlanId());
  }

  getMetrics(): BillingMetrics {
    const sub: Subscription = this.subscription.get();
    return {
      currentPlanId: sub.planId,
      monthlyCost: sub.currentPrice,
      creditsRemaining: this.usage.getCreditsRemaining(),
      creditsTotal: this.usage.getCreditsTotal(),
      renewalDate: sub.renewalDate,
      storageUsedMb: this.usage.getStorageUsedMb(),
      storageLimitMb: this.usage.getStorageLimitMb(),
      conversationCount: this.usage.getConversationCount(),
      invoiceCount: this.invoices.getCount(),
      subscriptionStatus: sub.status,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    };
  }

  previewPlanChange(toPlanId: PlanId): PlanChangePreview {
    return this.subscription.previewChange(toPlanId);
  }

  getUpgradeOptions(): Plan[] {
    return this.plans.getUpgrades(this.subscription.getCurrentPlanId());
  }

  getDowngradeOptions(): Plan[] {
    return this.plans.getDowngrades(this.subscription.getCurrentPlanId());
  }

  getInvoices(): Invoice[] {
    return this.invoices.getAll();
  }

  // Real, immediate DB writes - see SubscriptionActionService. Reloads
  // (force) so every dependent service reflects the new state.
  async cancelSubscription(): Promise<void> {
    await BillingApi.cancelSubscription();
    await this.load({ force: true });
  }

  async reactivateSubscription(): Promise<void> {
    await BillingApi.reactivateSubscription();
    await this.load({ force: true });
  }

  // Throws PaymentRequiredClientError (never silently succeeds) when the
  // target plan isn't $0 - see SubscriptionActionService.changePlan.
  async changePlan(planId: PlanId): Promise<void> {
    try {
      await BillingApi.changePlan(planId);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "PAYMENT_REQUIRED") {
        throw new PaymentRequiredClientError(err.message);
      }
      throw err;
    }
    await this.load({ force: true });
  }
}

export const billingEngine = new BillingEngine();
