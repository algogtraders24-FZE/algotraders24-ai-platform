// types/billing.ts
// Sprint 13A — Subscription & Billing Foundation
// Central type definitions for the SaaS billing system.

export type PlanId = "free" | "pro" | "elite" | "enterprise";

export type PlanStatus = "active" | "deprecated" | "hidden";

export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "paused";

export type BillingCycle = "monthly" | "yearly";

export type InvoiceStatus = "paid" | "open" | "void" | "refunded" | "failed";

export type PaymentProvider = "stripe" | "nowpayments" | "mock";

export type PaymentMethodType = "card" | "crypto" | "paypal";

export interface Plan {
  id: PlanId;
  name: string;
  description: string;
  priceMonthly: number;
  priceYearly: number;
  aiCredits: number;
  maxAgents: number;
  maxAutomations: number;
  maxKnowledgeDocuments: number;
  storageLimit: number; // in MB
  apiAccess: boolean;
  prioritySupport: boolean;
  customBranding: boolean;
  teamMembers: number;
  status: PlanStatus;
  highlighted: boolean;
  features: string[];
}

export interface Subscription {
  id: string;
  userId: string;
  planId: PlanId;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  currentPrice: number;
  startedAt: string;
  renewalDate: string;
  canceledAt: string | null;
  trialEndsAt: string | null;
  provider: PaymentProvider;
  autoRenew: boolean;
}

export interface UsageMetric {
  label: string;
  used: number;
  limit: number; // -1 = unlimited
  unit: string;
}

export interface UsageOverview {
  subscriptionId: string;
  periodStart: string;
  periodEnd: string;
  aiCreditsUsed: number;
  aiCreditsLimit: number;
  agentsUsed: number;
  agentsLimit: number;
  automationsUsed: number;
  automationsLimit: number;
  knowledgeDocsUsed: number;
  knowledgeDocsLimit: number;
  storageUsedMb: number;
  storageLimitMb: number;
  apiCallsUsed: number;
  apiCallsLimit: number;
}

export interface Invoice {
  id: string;
  number: string;
  userId: string;
  subscriptionId: string;
  planId: PlanId;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  issuedAt: string;
  paidAt: string | null;
  periodStart: string;
  periodEnd: string;
  provider: PaymentProvider;
  downloadUrl: string;
}

export interface PaymentMethod {
  id: string;
  userId: string;
  type: PaymentMethodType;
  provider: PaymentProvider;
  brand: string;
  last4: string;
  expiryMonth: number | null;
  expiryYear: number | null;
  isDefault: boolean;
  addedAt: string;
}

export interface Discount {
  id: string;
  code: string;
  description: string;
  percentOff: number | null;
  amountOff: number | null;
  appliesToPlans: PlanId[];
  validUntil: string | null;
  active: boolean;
}

export interface BillingMetrics {
  currentPlanId: PlanId;
  monthlyCost: number;
  creditsRemaining: number;
  creditsTotal: number;
  renewalDate: string;
  storageUsedMb: number;
  storageLimitMb: number;
  apiUsagePct: number;
  invoiceCount: number;
  subscriptionStatus: SubscriptionStatus;
}

export interface PlanChangePreview {
  fromPlanId: PlanId;
  toPlanId: PlanId;
  direction: "upgrade" | "downgrade" | "same";
  priceDelta: number;
  effectiveDate: string;
  prorationCredit: number;
}
