// config/billing.config.ts
// Sprint 13A — Subscription & Billing Foundation
// Central configuration for plans, colors, and billing behavior.

import type {
  PlanId,
  PlanStatus,
  SubscriptionStatus,
  InvoiceStatus,
  BillingCycle,
  PaymentMethodType,
} from "@/types/billing";

export const PLAN_IDS: PlanId[] = ["free", "pro", "elite", "enterprise"];

export const PLAN_ORDER: Record<PlanId, number> = {
  free: 0,
  pro: 1,
  elite: 2,
  enterprise: 3,
};

export const PLAN_LABELS: Record<PlanId, string> = {
  free: "Free",
  pro: "Pro",
  elite: "Elite",
  enterprise: "Enterprise",
};

export const PLAN_COLORS: Record<PlanId, string> = {
  free: "#94a3b8",
  pro: "#38bdf8",
  elite: "#a78bfa",
  enterprise: "#fbbf24",
};

export const PLAN_ACCENTS: Record<PlanId, string> = {
  free: "from-slate-500/20 to-slate-500/5",
  pro: "from-sky-500/20 to-sky-500/5",
  elite: "from-violet-500/20 to-violet-500/5",
  enterprise: "from-amber-500/20 to-amber-500/5",
};

export const SUBSCRIPTION_STATUS_COLORS: Record<SubscriptionStatus, string> = {
  active: "#34d399",
  trialing: "#38bdf8",
  past_due: "#fbbf24",
  canceled: "#f87171",
  paused: "#94a3b8",
};

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  active: "Active",
  trialing: "Trialing",
  past_due: "Past Due",
  canceled: "Canceled",
  paused: "Paused",
};

export const INVOICE_STATUS_COLORS: Record<InvoiceStatus, string> = {
  paid: "#34d399",
  open: "#38bdf8",
  void: "#94a3b8",
  refunded: "#a78bfa",
  failed: "#f87171",
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  paid: "Paid",
  open: "Open",
  void: "Void",
  refunded: "Refunded",
  failed: "Failed",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodType, string> = {
  card: "Card",
  crypto: "Crypto",
  paypal: "PayPal",
};

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  active: "Active",
  deprecated: "Deprecated",
  hidden: "Hidden",
};

// Yearly discount applied vs 12x monthly (used for display/marketing)
export const YEARLY_DISCOUNT_PCT = 20;

export const CURRENCY = {
  code: "USD",
  symbol: "$",
  locale: "en-US",
} as const;

export const BILLING_CYCLES: BillingCycle[] = ["monthly", "yearly"];

export const BILLING_CYCLE_LABELS: Record<BillingCycle, string> = {
  monthly: "Monthly",
  yearly: "Yearly",
};

// Thresholds for usage warnings (percent of limit)
export const USAGE_THRESHOLDS = {
  warning: 75,
  critical: 90,
} as const;

// Mock user for this build (no auth yet)
export const MOCK_USER_ID = "u1";

// Feature comparison rows for PlanComparison table
export const COMPARISON_ROWS: { key: string; label: string; type: "number" | "boolean" | "storage" }[] = [
  { key: "aiCredits", label: "AI Credits / month", type: "number" },
  { key: "maxAgents", label: "AI Agents", type: "number" },
  { key: "maxAutomations", label: "Automations", type: "number" },
  { key: "maxKnowledgeDocuments", label: "Knowledge Documents", type: "number" },
  { key: "storageLimit", label: "Storage", type: "storage" },
  { key: "teamMembers", label: "Team Members", type: "number" },
  { key: "apiAccess", label: "API Access", type: "boolean" },
  { key: "prioritySupport", label: "Priority Support", type: "boolean" },
  { key: "customBranding", label: "Custom Branding", type: "boolean" },
];
