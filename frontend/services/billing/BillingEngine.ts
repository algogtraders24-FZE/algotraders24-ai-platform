// services/billing/BillingEngine.ts
// Sprint 13A — Subscription & Billing Foundation
// Top-level orchestrator that composes all billing services.

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

export class BillingEngine {
  plans: PlanService;
  pricing: PricingService;
  subscription: SubscriptionManager;
  invoices: InvoiceService;
  usage: UsageService;
  discounts: DiscountService;

  private paymentMethods: PaymentMethod[];

  constructor(paymentMethods: PaymentMethod[] = MOCK_PAYMENT_METHODS) {
    this.plans = planService;
    this.pricing = pricingService;
    this.subscription = subscriptionManager;
    this.invoices = invoiceService;
    this.usage = usageService;
    this.discounts = discountService;
    this.paymentMethods = paymentMethods;
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
