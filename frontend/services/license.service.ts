import { LICENSES } from "@/data/licenses";
import type { License } from "@/types/license";

export const licenseService = {
  getAll: (): License[] => LICENSES,
  getById: (id: string): License | undefined => LICENSES.find((l) => l.id === id),
  getByCustomer: (customerId: string): License[] => LICENSES.filter((l) => l.customerId === customerId),
};