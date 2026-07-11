// lib/auth/protectedRoute.ts
// Sprint 14C - Server-side route guards.
// Use inside Server Components / Route Handlers to require an authenticated
// user (and optionally a role). Middleware guards navigation; these helpers
// give you the verified user object and enforce authorization in-handler.
import { redirect } from "next/navigation";
import { SessionService, type SessionUser } from "@/services/auth/SessionService";

// For Server Components / pages: redirects to /login if not authenticated.
export async function requireUser(redirectTo = "/login"): Promise<SessionUser> {
  const sessionUser = await SessionService.getSessionUser();
  if (!sessionUser) {
    redirect(redirectTo);
  }
  return sessionUser;
}

// For Server Components / pages: requires a specific role, else redirect.
export async function requireRole(
  role: "admin" | "user",
  redirectTo = "/dashboard"
): Promise<SessionUser> {
  const sessionUser = await SessionService.getSessionUser();
  if (!sessionUser) {
    redirect("/login");
  }
  if (sessionUser.profile.role !== role) {
    redirect(redirectTo);
  }
  return sessionUser;
}

// For Route Handlers (/api/private/*): returns user or null (no redirect).
// Handler decides the response (usually 401/403 JSON).
export async function getUserOrNull(): Promise<SessionUser | null> {
  return SessionService.getSessionUser();
}

// For Route Handlers: throws a typed result you can convert to a 403.
export async function assertRole(
  role: "admin" | "user"
): Promise<{ ok: true; user: SessionUser } | { ok: false; status: 401 | 403 }> {
  const sessionUser = await SessionService.getSessionUser();
  if (!sessionUser) {
    return { ok: false, status: 401 };
  }
  if (sessionUser.profile.role !== role) {
    return { ok: false, status: 403 };
  }
  return { ok: true, user: sessionUser };
}
