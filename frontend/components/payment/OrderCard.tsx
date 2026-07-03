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
    <div className="rounded-2xl bg-[#0C1324] border border-[#1F2937] p-6">
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-sm text-gray-400">#{order.id}</span>
        <PaymentStatus status={ORDER_TO_PAYMENT[order.status]} />
      </div>
      <div className="space-y-1 text-sm text-gray-300">
        {order.items.map((it) => (
          <div key={it.productId} className="flex justify-between">
            <span>{it.name}</span>
            <span>${it.price}</span>
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-4 pt-3 border-t border-[#1F2937] font-bold">
        <span>Total</span>
        <span>${order.total} {order.currency}</span>
      </div>
      <div className="text-xs text-gray-500 mt-2">{order.createdAt}</div>
    </div>
  );
}