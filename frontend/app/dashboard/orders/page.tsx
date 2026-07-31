import OrderCard from "@/components/payment/OrderCard";
import { orderService } from "@/services/order.service";
import { authService } from "@/services/auth.service";
import EmptyState from "@/components/ui/EmptyState";
import ButtonLink from "@/components/ui/ButtonLink";

export default async function OrdersPage() {
  const user = await authService.getCurrentUser();
  const orders = orderService.getByCustomer(user?.id ?? "");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-text">My Orders</h1>
      {orders.length === 0 ? (
        <EmptyState title="No orders yet." action={<ButtonLink href="/products">Browse products</ButtonLink>} />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {orders.map((o) => <OrderCard key={o.id} order={o} />)}
        </div>
      )}
    </div>
  );
}
