// services/billing/InvoiceService.ts
// Sprint 13A — Subscription & Billing Foundation
// Query layer over invoice history.

import type { Invoice, InvoiceStatus } from "@/types/billing";
import { MOCK_INVOICES } from "@/data/mock-billing";

export class InvoiceService {
  private invoices: Invoice[];

  constructor(invoices: Invoice[] = MOCK_INVOICES) {
    this.invoices = invoices;
  }

  getAll(): Invoice[] {
    return [...this.invoices].sort(
      (a, b) =>
        new Date(b.issuedAt).getTime() - new Date(a.issuedAt).getTime()
    );
  }

  getById(id: string): Invoice | null {
    return this.invoices.find((i) => i.id === id) ?? null;
  }

  getByStatus(status: InvoiceStatus): Invoice[] {
    return this.getAll().filter((i) => i.status === status);
  }

  getCount(): number {
    return this.invoices.length;
  }

  getTotalPaid(): number {
    return this.invoices
      .filter((i) => i.status === "paid")
      .reduce((sum, i) => sum + i.amount, 0);
  }

  getLatest(): Invoice | null {
    return this.getAll()[0] ?? null;
  }
}

export const invoiceService = new InvoiceService();
