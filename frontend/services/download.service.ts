import { DOWNLOADS } from "@/data/downloads";
import type { Download } from "@/types/download";

export const downloadService = {
  getAll: (): Download[] => DOWNLOADS,
  getByCustomer: (customerId: string): Download[] => DOWNLOADS.filter((d) => d.customerId === customerId),
};