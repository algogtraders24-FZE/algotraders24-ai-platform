import { SUBSCRIPTIONS } from "@/data/subscriptions";
import type { Subscription } from "@/types/subscription";

export const subscriptionService = {
  getAll: (): Subscription[] => SUBSCRIPTIONS,
  getByCustomer: (customerId: string): Subscription[] => SUBSCRIPTIONS.filter((s) => s.customerId === customerId),
};