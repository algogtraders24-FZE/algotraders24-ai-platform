import type { LicenseStatus } from "@/types/license";

export const LICENSE_STATUS_META: Record<LicenseStatus, { label: string; color: string }> = {
  active: { label: "Active", color: "#22C55E" },
  expired: { label: "Expired", color: "#EF4444" },
  revoked: { label: "Revoked", color: "#94A3B8" },
};

export const RENEWAL_WARNING_DAYS = 14; // itne din bache to renew dikhao
export const DEFAULT_MAX_ACTIVATIONS = 3;