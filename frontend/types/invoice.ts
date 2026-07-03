export interface Invoice {
  id: string;
  invoiceNumber: string;
  orderId: string;
  customerId: string;
  amount: number;
  currency: string;
  issuedAt: string;
  dueAt: string;
  paid: boolean;
}