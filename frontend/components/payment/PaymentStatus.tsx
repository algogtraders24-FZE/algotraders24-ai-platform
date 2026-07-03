import type { PaymentStatus as Status } from "@/types/payment";
import { PAYMENT_STATE_META } from "@/config/payment.config";

export default function PaymentStatus({ status }: { status: Status }) {
  const meta = PAYMENT_STATE_META[status];
  return (
    <span className="text-xs font-semibold px-3 py-1 rounded-full"
      style={{ backgroundColor: `${meta.color}20`, color: meta.color }}>
      {meta.label}
    </span>
  );
}