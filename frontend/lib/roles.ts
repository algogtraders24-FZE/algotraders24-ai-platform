export type Role = "guest" | "customer" | "admin" | "affiliate";

export const ROLES: Record<Role, string> = {
  guest: "Guest",
  customer: "Customer",
  admin: "Admin",
  affiliate: "Affiliate",
};

export function isValidRole(role: string): role is Role {
  return role in ROLES;
}