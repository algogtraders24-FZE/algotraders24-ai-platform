import type { License } from "@/types/license";

export function isLicenseActive(license: License): boolean {
  if (license.status !== "active") return false;
  if (license.expiresAt === null) return true; // lifetime
  return new Date(license.expiresAt).getTime() > Date.now();
}

export function activationsLeft(license: License): number {
  return Math.max(0, license.maxActivations - license.activations);
}