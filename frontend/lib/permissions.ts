import type { Role } from "@/lib/roles";

export type Permission =
  | "view_dashboard"
  | "manage_products"
  | "view_orders"
  | "manage_users"
  | "view_affiliate";

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  guest: [],
  customer: ["view_dashboard", "view_orders"],
  affiliate: ["view_dashboard", "view_affiliate"],
  admin: ["view_dashboard", "manage_products", "view_orders", "manage_users", "view_affiliate"],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}