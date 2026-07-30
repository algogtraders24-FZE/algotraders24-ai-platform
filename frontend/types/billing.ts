// types/billing.ts
// Sprint 13A — Subscription & Billing Foundation
// Central type definitions for the SaaS billing system.
//
// Sprint L2.5 - Removed PaymentProvider/PaymentMethod/Discount: none of
// these were ever backed by a real payment provider or a database table -
// they rendered fabricated data (a fake Visa card, fake discount codes,
// a "mock" provider label) presented as if real. See the L2.5 audit report
// for the full accounting. UsageOverview/UsageMetric are rewritten to
// describe only metrics this app can actually measure (see
// services/billing/UsageMeteringService.ts), each explicitly flagged
// `tracked: false` when no real instrumentation exists yet, rather than
// showing a fabricated number.

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
  cancelAtPeriodEnd: boolean;
}

// A single metered quantity compared against a plan limit. `tracked: false`
// means this app has no real instrumentation for the metric yet (see
// EntitlementService) - the UI must show that honestly, never a fabricated
// number.
export interface UsageMetric {
  label: string;
  used: number;
  limit: number; // -1 = unlimited
  unit: string;
  tracked: boolean;
}

export interface Entitlement {
  used: number;
  limit: number;
  remaining: number;
  pct: number; // 0-100
  atLimit: boolean;
}

// Sprint L2.5 - The single, centralized shape both the Billing dashboard and
// (in a future sprint, once authorized to touch those pipelines) any other
// page would read to answer "is this user allowed to do X right now?". See
// services/billing/EntitlementService.ts - the one place this is computed.
export interface Entitlements {
  planId: PlanId;
  periodStart: string;
  periodEnd: string;
  aiMessages: Entitlement;
  knowledgeDocuments: Entitlement;
  storageMb: Entitlement;
  conversations: { used: number };
  marketAnalysisRequests: { tracked: false };
  searchRequests: { tracked: false };
  apiAccess: boolean;
  prioritySupport: boolean;
  customBranding: boolean;
  teamMembers: number;
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
  // No PDF/receipt generation exists (no payment provider is wired) -
  // always false today. Kept as a field (rather than removed) so the UI
  // has one real, disclosed reason to disable the download action.
  downloadAvailable: boolean;
}

export interface BillingMetrics {
  currentPlanId: PlanId;
  monthlyCost: number;
  creditsRemaining: number;
  creditsTotal: number;
  renewalDate: string;
  storageUsedMb: number;
  storageLimitMb: number;
  conversationCount: number;
  invoiceCount: number;
  subscriptionStatus: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
}

export interface PlanChangePreview {
  fromPlanId: PlanId;
  toPlanId: PlanId;
  direction: "upgrade" | "downgrade" | "same";
  priceDelta: number;
  effectiveDate: string;
  // true whenever completing this change would require charging the user
  // (target plan price > 0) - no payment provider is wired yet (see the
  // L2.5 audit), so these changes are blocked with an honest message
  // rather than silently granted for free.
  requiresPayment: boolean;
}
