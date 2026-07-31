import type { Order } from "@/types/order";
import PaymentStatus from "./PaymentStatus";
import type { PaymentStatus as Status } from "@/types/payment";

const ORDER_TO_PAYMENT: Record<Order["status"], Status> = {
  pending: "pending",
  paid: "completed",
  refunded: "refunded",
  failed: "failed",
};

export default function OrderCard({ order }: { order: Order }) {
  return (
    <div className="rounded-2xl bg-ink-2 border border-border p-6">
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-sm text-text-2">#{order.id}</span>
        <PaymentStatus status={ORDER_TO_PAYMENT[order.status]} />
      </div>
      <div className="space-y-1 text-sm text-text-2">
        {order.items.map((it) => (
          <div key={it.productId} className="flex justify-between">
            <span>{it.name}</span>
            <span>${it.price}</span>
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-4 pt-3 border-t border-border font-bold">
        <span>Total</span>
        <span>${order.total} {order.currency}</span>
      </div>
      <div className="text-xs text-text-3 mt-2">{order.createdAt}</div>
    </div>
  );
}