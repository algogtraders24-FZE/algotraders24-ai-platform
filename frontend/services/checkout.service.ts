import type { CheckoutItem, CheckoutSession } from "@/types/checkout";
import type { PaymentProvider } from "@/types/payment";

export const checkoutService = {
  createSession: (items: CheckoutItem[], provider: PaymentProvider, currency = "USD"): CheckoutSession => {
    const subtotal = items.reduce((sum, i) => sum + i.price, 0);
    return { items, subtotal, total: subtotal, currency, provider };
  },
};