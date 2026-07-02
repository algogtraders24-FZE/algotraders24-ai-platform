import type { License } from "@/types/license";

export const LICENSES: License[] = [
  { id: "l1", key: "AXON-4F2A-9C1B", customerId: "c1", productId: "p1", type: "lifetime", status: "active", activations: 1, maxActivations: 3, issuedAt: "2025-06-12", expiresAt: null },
  { id: "l2", key: "QSCP-7B3D-2E8F", customerId: "c2", productId: "p2", type: "annual", status: "active", activations: 2, maxActivations: 2, issuedAt: "2025-08-03", expiresAt: "2026-08-03" },
  { id: "l3", key: "SMIN-1A9C-6D4E", customerId: "c3", productId: "p3", type: "lifetime", status: "active", activations: 1, maxActivations: 5, issuedAt: "2025-09-19", expiresAt: null },
  { id: "l4", key: "NFTY-8E2B-3F7A", customerId: "c1", productId: "p5", type: "monthly", status: "expired", activations: 1, maxActivations: 1, issuedAt: "2025-10-01", expiresAt: "2025-11-01" },
];