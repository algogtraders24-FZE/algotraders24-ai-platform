export type CustomerStatus = "active" | "inactive" | "banned";

export interface Customer {
  id: string;
  name: string;
  email: string;
  country: string;
  status: CustomerStatus;
  affiliateCode?: string;
  createdAt: string;
}