"use client";
// components/billing/InvoiceHistory.tsx
// Sprint 13A — Subscription & Billing Foundation

import type { Invoice } from "@/types/billing";
import {
  INVOICE_STATUS_COLORS,
  INVOICE_STATUS_LABELS,
  PLAN_LABELS,
} from "@/config/billing.config";
import { pricingService } from "@/services/billing/PricingService";

interface Props {
  invoices: Invoice[];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function InvoiceHistory({ invoices }: Props) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
      <div className="flex items-center justify-between px-6 py-4">
        <h3 className="text-lg font-semibold text-white">Invoice History</h3>
        <span className="text-xs text-slate-500">{invoices.length} total</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-sm">
          <thead>
            <tr className="border-y border-white/10 text-left text-xs uppercase tracking-wider text-slate-500">
              <th className="px-6 py-3 font-medium">Invoice</th>
              <th className="px-6 py-3 font-medium">Date</th>
              <th className="px-6 py-3 font-medium">Plan</th>
              <th className="px-6 py-3 font-medium">Amount</th>
              <th className="px-6 py-3 font-medium">Status</th>
              <th className="px-6 py-3 text-right font-medium">Receipt</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => {
              const color = INVOICE_STATUS_COLORS[inv.status];
              return (
                <tr
                  key={inv.id}
                  className="border-b border-white/5 transition hover:bg-white/[0.03] last:border-0"
                >
                  <td className="px-6 py-4 font-mono text-xs text-slate-300">
                    {inv.number}
                  </td>
                  <td className="px-6 py-4 text-slate-400">
                    {formatDate(inv.issuedAt)}
                  </td>
                  <td className="px-6 py-4 text-slate-300">
                    {PLAN_LABELS[inv.planId]}
                  </td>
                  <td className="px-6 py-4 font-medium text-slate-200">
                    {pricingService.formatPrice(inv.amount)}
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className="rounded-full px-2.5 py-1 text-xs font-semibold"
                      style={{ backgroundColor: color + "22", color }}
                    >
                      {INVOICE_STATUS_LABELS[inv.status]}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <a href={inv.downloadUrl} className="text-xs font-medium text-sky-400 transition hover:text-sky-300">
                      Download
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
