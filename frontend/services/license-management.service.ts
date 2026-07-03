import { LICENSES } from "@/data/licenses";
import type { License } from "@/types/license";

export const licenseManagementService = {
  getMyLicenses: (customerId: string): License[] =>
    LICENSES.filter((l) => l.customerId === customerId),

  getById: (licenseId: string): License | undefined =>
    LICENSES.find((l) => l.id === licenseId),
};