import { CUSTOMERS } from "@/data/customers";
import type { Customer } from "@/types/customer";

export const customerService = {
  getAll: (): Customer[] => CUSTOMERS,
  getById: (id: string): Customer | undefined => CUSTOMERS.find((c) => c.id === id),
};