import type { Role } from "@/lib/roles";

export const AUTH_CONFIG = {
  sessionTimeoutMinutes: 60,
  defaultRole: "guest" as Role,
  protectedRoutes: ["/dashboard", "/admin", "/account"],
  publicRoutes: ["/", "/products", "/pricing", "/about", "/contact"],
};