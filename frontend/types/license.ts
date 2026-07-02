export type LicenseStatus = "active" | "expired" | "revoked";
export type LicenseType = "lifetime" | "annual" | "monthly";

export interface License {
  id: string;
  key: string; // e.g. "AXON-XXXX-XXXX"
  customerId: string; // -> Customer.id
  productId: string; // -> Product.id
  type: LicenseType;
  status: LicenseStatus;
  activations: number;
  maxActivations: number;
  issuedAt: string;
  expiresAt: string | null; // null = lifetime
}