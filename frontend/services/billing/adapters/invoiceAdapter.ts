// services/billing/adapters/invoiceAdapter.ts
// Sprint 14E - Maps database Billing rows onto the UI Invoice domain type.
// The Billing table stores the payment record (planId, status, amount).
// Presentation fields (number, currency, period) are derived from real data.
// Sprint L2.5 - Removed the hardcoded `provider: "mock"` field and the
// fake `downloadUrl: "#"` (no receipt/PDF generation exists - no payment
// provider is connected, see the L2.5 audit). `downloadAvailable: false`
// lets the UI disable the download action honestly instead of rendering a
// dead link that looks functional.
import type { Invoice, InvoiceStatus, PlanId } from "@/types/billing";
import type { ApiBillingRecord } from "@/services/api/BillingApi";
import { CURRENCY } from "@/config/billing.config";
import { isPlanId } from "@/config/plan-limits";

function toInvoiceStatus(status: ApiBillingRecord["status"]): InvoiceStatus {
  if (status === "canceled") return "void";
  if (status === "past_due") return "failed";
  return "paid";
}

function invoiceNumber(id: string, issuedAt: string): string {
  const year = new Date(issuedAt).getFullYear();
  const suffix = id.slice(-6).toUpperCase();
  return `INV-${year}-${suffix}`;
}

export function toInvoice(row: ApiBillingRecord, userId: string): Invoice {
  const planId: PlanId = isPlanId(row.planId) ? row.planId : "free";
  const issuedAt = row.createdAt;

  const periodStart = new Date(issuedAt);
  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const status = toInvoiceStatus(row.status);

  return {
    id: row.id,
    number: invoiceNumber(row.id, issuedAt),
    userId,
    subscriptionId: "",
    planId,
    amount: row.amount,
    currency: CURRENCY.code,
    status,
    issuedAt,
    paidAt: status === "paid" ? row.updatedAt : null,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    downloadAvailable: false,
  };
}

export function toInvoices(
  rows: ApiBillingRecord[],
  userId: string
): Invoice[] {
  return rows.map((r) => toInvoice(r, userId));
}