import type { PaymentProvider, PaymentStatus } from "@/types/payment";

export const PAYMENT_PROVIDERS: PaymentProvider[] = ["stripe", "crypto", "paypal"];

export const SUPPORTED_CURRENCIES = ["USD", "EUR", "INR", "AED"];

export const ORDER_STATES = ["pending", "paid", "refunded", "failed"] as const;

export const PAYMENT_STATE_META: Record<PaymentStatus, { label: string; color: string }> = {
  pending: { label: "Pending", color: "#F59E0B" },
  completed: { label: "Completed", color: "#22C55E" },
  failed: { label: "Failed", color: "#EF4444" },
  refunded: { label: "Refunded", color: "#94A3B8" },
};