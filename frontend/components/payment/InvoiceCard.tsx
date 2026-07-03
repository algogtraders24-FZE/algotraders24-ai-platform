import type { Invoice } from "@/types/invoice";

export default function InvoiceCard({ invoice }: { invoice: Invoice }) {
  return (
    <div className="rounded-2xl bg-[#0C1324] border border-[#1F2937] p-6">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-sm">{invoice.invoiceNumber}</span>
        <span className={`text-xs font-semibold px-3 py-1 rounded-full ${
          invoice.paid ? "bg-[#22C55E]/20 text-[#22C55E]" : "bg-[#F59E0B]/20 text-[#F59E0B]"
        }`}>
          {invoice.paid ? "Paid" : "Unpaid"}
        </span>
      </div>
      <div className="text-2xl font-bold">${invoice.amount} <span className="text-sm text-gray-400 font-normal">{invoice.currency}</span></div>
      <div className="text-xs text-gray-500 mt-2">Issued {invoice.issuedAt}</div>
    </div>
  );
}