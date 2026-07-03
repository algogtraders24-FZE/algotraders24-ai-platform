import InvoiceCard from "@/components/payment/InvoiceCard";
import { invoiceService } from "@/services/invoice.service";
import { authService } from "@/services/auth.service";

export default function PaymentsPage() {
  const user = authService.getCurrentUser();
  const invoices = invoiceService.getByCustomer(user?.id ?? "");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Payments & Invoices</h1>
      {invoices.length === 0 ? (
        <p className="text-gray-400">No invoices yet.</p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {invoices.map((inv) => <InvoiceCard key={inv.id} invoice={inv} />)}
        </div>
      )}
    </div>
  );
}