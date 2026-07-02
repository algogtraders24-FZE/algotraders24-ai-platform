import type { Customer } from "@/types/customer";

export const CUSTOMERS: Customer[] = [
  { id: "c1", name: "Rajesh Kumar", email: "rajesh@example.com", country: "IN", status: "active", affiliateCode: "RAJ10", createdAt: "2025-06-12" },
  { id: "c2", name: "Sarah Mitchell", email: "sarah@example.com", country: "UK", status: "active", createdAt: "2025-08-03" },
  { id: "c3", name: "Ahmed Al-Farsi", email: "ahmed@example.com", country: "AE", status: "active", affiliateCode: "AHM20", createdAt: "2025-09-19" },
  { id: "c4", name: "David Chen", email: "david@example.com", country: "SG", status: "inactive", createdAt: "2025-11-01" },
];