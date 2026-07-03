import type { Invoice } from "@/types/invoice";

export const INVOICES: Invoice[] = [
  { id: "inv1", invoiceNumber: "INV-2025-001", orderId: "o1", customerId: "c1", amount: 299, currency: "USD", issuedAt: "2025-06-12", dueAt: "2025-06-12", paid: true },
  { id: "inv2", invoiceNumber: "INV-2025-002", orderId: "o2", customerId: "c2", amount: 249, currency: "USD", issuedAt: "2025-08-03", dueAt: "2025-08-03", paid: true },
  { id: "inv3", invoiceNumber: "INV-2025-003", orderId: "o3", customerId: "c3", amount: 149, currency: "USD", issuedAt: "2025-09-19", dueAt: "2025-09-19", paid: true },
];