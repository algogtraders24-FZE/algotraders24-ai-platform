export type PaymentStatus = "pending" | "completed" | "failed" | "refunded";
export type PaymentProvider = "stripe" | "crypto" | "paypal";

export interface Payment {
  id: string;
  orderId: string;
  customerId: string;
  amount: number;
  currency: string;
  provider: PaymentProvider;
  status: PaymentStatus;
  createdAt: string;
}