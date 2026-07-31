import Link from "next/link";
import OrderCard from "@/components/payment/OrderCard";
import { orderService } from "@/services/order.service";
import { authService } from "@/services/auth.service";

export default async function OrdersPage() {
  const user = await authService.getCurrentUser();
  const orders = orderService.getByCustomer(user?.id ?? "");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">My Orders</h1>
      {orders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#1F2937] p-10 text-center">
          <p className="text-sm text-gray-400">No orders yet.</p>
          <Link
            href="/products"
            className="mt-3 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
          >
            Browse products
          </Link>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {orders.map((o) => <OrderCard key={o.id} order={o} />)}
        </div>
      )}
    </div>
  );
}

