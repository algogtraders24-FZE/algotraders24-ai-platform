import { ORDERS } from "@/data/orders";
import type { Order } from "@/types/order";

export const orderService = {
  getAll: (): Order[] => ORDERS,
  getById: (id: string): Order | undefined => ORDERS.find((o) => o.id === id),
  getByCustomer: (customerId: string): Order[] => ORDERS.filter((o) => o.customerId === customerId),
};