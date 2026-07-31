"use client";
// components/billing/InvoiceHistory.tsx
// Sprint 13A — Subscription & Billing Foundation
// Sprint D1.0 - Retrofitted onto Table/Badge/EmptyState + tokens.
import type { Invoice } from "@/types/billing";
import { INVOICE_STATUS_LABELS, PLAN_LABELS } from "@/config/billing.config";
import { pricingService } from "@/services/billing/PricingService";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/ui/Table";
import Badge, { type BadgeTone } from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";

interface Props {
  invoices: Invoice[];
}

const STATUS_TONE: Record<Invoice["status"], BadgeTone> = {
  paid: "success",
  open: "info",
  void: "neutral",
  refunded: "info",
  failed: "danger",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function InvoiceHistory({ invoices }: Props) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-text">Invoice History</h3>
        <span className="text-xs text-text-3">{invoices.length} total</span>
      </div>

      {invoices.length === 0 ? (
        <EmptyState title="No invoices yet." description="Your billing history will appear here after your first payment." />
      ) : (
        <Table className="min-w-[600px]">
          <Thead>
            <tr>
              <Th>Invoice</Th>
              <Th>Date</Th>
              <Th>Plan</Th>
              <Th>Amount</Th>
              <Th>Status</Th>
              <Th className="text-right">Receipt</Th>
            </tr>
          </Thead>
          <Tbody>
            {invoices.map((inv) => (
              <Tr key={inv.id}>
                <Td className="font-mono text-xs text-text-2">{inv.number}</Td>
                <Td>{formatDate(inv.issuedAt)}</Td>
                <Td className="text-text-2">{PLAN_LABELS[inv.planId]}</Td>
                <Td className="font-medium text-text">{pricingService.formatPrice(inv.amount)}</Td>
                <Td>
                  <Badge tone={STATUS_TONE[inv.status]}>{INVOICE_STATUS_LABELS[inv.status]}</Badge>
                </Td>
                <Td className="text-right">
                  {inv.downloadAvailable ? (
                    <button className="text-xs font-medium text-gold transition hover:text-gold-strong">Download</button>
                  ) : (
                    <span
                      className="text-xs text-text-3"
                      title="Receipt download requires payment provider integration, which is not yet connected."
                    >
                      Unavailable
                    </span>
                  )}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </div>
  );
}
