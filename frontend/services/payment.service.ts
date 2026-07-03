import { PAYMENTS } from "@/data/payments";
import type { Payment } from "@/types/payment";

export const paymentService = {
  getAll: (): Payment[] => PAYMENTS,
  getByCustomer: (customerId: string): Payment[] => PAYMENTS.filter((p) => p.customerId === customerId),
  getByOrder: (orderId: string): Payment | undefined => PAYMENTS.find((p) => p.orderId === orderId),
};