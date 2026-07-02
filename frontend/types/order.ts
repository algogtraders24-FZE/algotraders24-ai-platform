export type OrderStatus = "pending" | "paid" | "refunded" | "failed";
export type PaymentMethod = "card" | "crypto" | "paypal";

export interface OrderItem {
  productId: string; // -> Product.id
  name: string;
  price: number;
}

export interface Order {
  id: string;
  customerId: string; // -> Customer.id
  items: OrderItem[];
  total: number;
  currency: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  createdAt: string;
}