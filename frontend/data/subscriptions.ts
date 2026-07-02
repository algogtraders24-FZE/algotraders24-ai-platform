import type { Subscription } from "@/types/subscription";

export const SUBSCRIPTIONS: Subscription[] = [
  { id: "s1", customerId: "c1", planName: "AI Signals Pro", status: "active", billingCycle: "monthly", price: 49, currency: "USD", startedAt: "2025-06-15", renewsAt: "2026-02-15" },
  { id: "s2", customerId: "c2", planName: "Premium Research", status: "active", billingCycle: "yearly", price: 399, currency: "USD", startedAt: "2025-08-05", renewsAt: "2026-08-05" },
  { id: "s3", customerId: "c4", planName: "AI Signals Pro", status: "cancelled", billingCycle: "monthly", price: 49, currency: "USD", startedAt: "2025-11-02", renewsAt: "2025-12-02" },
];