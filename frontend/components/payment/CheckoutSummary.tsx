import type { CheckoutSession } from "@/types/checkout";

export default function CheckoutSummary({ session }: { session: CheckoutSession }) {
  return (
    <div className="rounded-2xl bg-[#0C1324] border border-[#1F2937] p-6">
      <h3 className="font-bold mb-4">Order Summary</h3>
      <div className="space-y-2 text-sm">
        {session.items.map((it) => (
          <div key={it.productId} className="flex justify-between text-gray-300">
            <span>{it.name}</span>
            <span>${it.price}</span>
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-4 pt-3 border-t border-[#1F2937] font-bold">
        <span>Total</span>
        <span>${session.total} {session.currency}</span>
      </div>
    </div>
  );
}