import type { PaymentProvider } from "@/types/payment";

export interface CheckoutItem {
  productId: string;
  name: string;
  price: number;
}

export interface CheckoutSession {
  items: CheckoutItem[];
  subtotal: number;
  total: number;
  currency: string;
  provider: PaymentProvider;
}