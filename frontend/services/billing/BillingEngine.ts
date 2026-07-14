// services/billing/BillingEngine.ts
// Sprint 13A - Top-level orchestrator that composes all billing services.
// Sprint 14E - Plans, subscription and invoices are now loaded from the
// database via /api/private/*. Call load() once before reading; every other
// method stays synchronous, so consuming components are unchanged.
//
// Still config-derived (real metering arrives with Sprint 15A):
//   - UsageService  (no usage counters persisted yet)
//   - DiscountService and payment methods (no provider integration yet)
import type {
  Plan,
  PlanId,
  Subscription,
  Invoice,
  PaymentMethod,
  UsageOverview,
  BillingMetrics,
  PlanChangePreview,
} from "@/types/billing";
import { MOCK_PAYMENT_METHODS } from "@/data/mock-billing";
import { planService, PlanService } from "./PlanService";
import { pricingService, PricingService } from "./PricingService";
import { subscriptionManager, SubscriptionManager } from "./SubscriptionManager";
import { invoiceService, InvoiceService } from "./InvoiceService";
import { usageService, UsageService } from "./UsageService";
import { discountService, DiscountService } from "./DiscountService";
import { BillingApi } from "@/services/api/BillingApi";
import { toPlans } from "./adapters/planAdapter";
import { toInvoices } from "./adapters/invoiceAdapter";
import {
  toSubscription,
  fallbackSubscription,
} from "./adapters/subscriptionAdapter";
import { isPlanId } from "@/config/plan-limits";

export class BillingEngine {
  plans: PlanService;
  pricing: PricingService;
  subscription: SubscriptionManager;
  invoices: InvoiceService;
  usage: UsageService;
  discounts: DiscountService;

  private paymentMethods: PaymentMethod[];
  private loaded = false;
  private inFlight: Promise<void> | null = null;

  constructor(paymentMethods: PaymentMethod[] = MOCK_PAYMENT_METHODS) {
    this.plans = planService;
    this.pricing = pricingService;
    this.subscription = subscriptionManager;
    this.invoices = invoiceService;
    this.usage = usageService;
    this.discounts = discountService;
    this.paymentMethods = paymentMethods;
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
    const [apiPlans, apiRecords, subEnvelope] = await Promise.all([
      BillingApi.listPlans({ signal }),
      BillingApi.listBillingRecords({ signal }),
      BillingApi.getSubscription({ signal }),
    ]);

    const plans = toPlans(apiPlans);
    this.plans.hydrate(plans);

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

  getPaymentMethods(): PaymentMethod[] {
    return [...this.paymentMethods];
  }

  getDefaultPaymentMethod(): PaymentMethod | null {
    return this.paymentMethods.find((m) => m.isDefault) ?? null;
  }

  getCurrentPlan(): Plan | null {
    return this.plans.getById(this.subscription.getCurrentPlanId());
  }

  getMetrics(): BillingMetrics {
    const sub: Subscription = this.subscription.get();
    const usage: UsageOverview = this.usage.get();
    return {
      currentPlanId: sub.planId,
      monthlyCost: sub.currentPrice,
      creditsRemaining: this.usage.getCreditsRemaining(),
      creditsTotal: usage.aiCreditsLimit,
      renewalDate: sub.renewalDate,
      storageUsedMb: this.usage.getStorageUsedMb(),
      storageLimitMb: this.usage.getStorageLimitMb(),
      apiUsagePct: this.usage.getApiUsagePct(),
      invoiceCount: this.invoices.getCount(),
      subscriptionStatus: sub.status,
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
}

export const billingEngine = new BillingEngine();