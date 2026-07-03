import type { Payment } from "@/types/payment";

export const PAYMENTS: Payment[] = [
  { id: "pay1", orderId: "o1", customerId: "c1", amount: 299, currency: "USD", provider: "stripe", status: "completed", createdAt: "2025-06-12" },
  { id: "pay2", orderId: "o2", customerId: "c2", amount: 249, currency: "USD", provider: "crypto", status: "completed", createdAt: "2025-08-03" },
  { id: "pay3", orderId: "o3", customerId: "c3", amount: 149, currency: "USD", provider: "paypal", status: "completed", createdAt: "2025-09-19" },
  { id: "pay4", orderId: "o4", customerId: "c1", amount: 179, currency: "USD", provider: "stripe", status: "refunded", createdAt: "2025-10-01" },
];