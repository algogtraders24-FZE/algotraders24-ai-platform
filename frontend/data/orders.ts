import type { Order } from "@/types/order";

export const ORDERS: Order[] = [
  { id: "o1", customerId: "c1", items: [{ productId: "p1", name: "AI Trend Master EA", price: 299 }], total: 299, currency: "USD", status: "paid", paymentMethod: "card", createdAt: "2025-06-12" },
  { id: "o2", customerId: "c2", items: [{ productId: "p2", name: "Quantum Scalper Pro", price: 249 }], total: 249, currency: "USD", status: "paid", paymentMethod: "crypto", createdAt: "2025-08-03" },
  { id: "o3", customerId: "c3", items: [{ productId: "p3", name: "Smart Money Indicator", price: 149 }], total: 149, currency: "USD", status: "paid", paymentMethod: "paypal", createdAt: "2025-09-19" },
  { id: "o4", customerId: "c1", items: [{ productId: "p5", name: "NIFTY Algo Pro", price: 179 }], total: 179, currency: "USD", status: "refunded", paymentMethod: "card", createdAt: "2025-10-01" },
];