export type SubscriptionStatus = "active" | "cancelled" | "past_due";
export type BillingCycle = "monthly" | "yearly";

export interface Subscription {
  id: string;
  customerId: string; // -> Customer.id
  planName: string;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  price: number;
  currency: string;
  startedAt: string;
  renewsAt: string;
}