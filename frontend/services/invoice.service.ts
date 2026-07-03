import { INVOICES } from "@/data/invoices";
import type { Invoice } from "@/types/invoice";

export const invoiceService = {
  getAll: (): Invoice[] => INVOICES,
  getByCustomer: (customerId: string): Invoice[] => INVOICES.filter((i) => i.customerId === customerId),
};