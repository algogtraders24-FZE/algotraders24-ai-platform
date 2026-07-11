// services/auth.service.ts
// Sprint 14C - SHIM. Was mock; now delegates to real Supabase-backed SessionService.
// Kept at the same path + method name so existing imports keep working.
// NOTE: getCurrentUser() is now ASYNC. Callers must `await` it.
import { SessionService } from "@/services/auth/SessionService";

export interface CurrentUserShape {
  id: string;
  authId: string | null;
  name: string;
  email: string;
  role: "user" | "admin";
  planId: string;
  status: "active" | "suspended";
  emailVerified: boolean;
}

export const authService = {
  // Real authenticated user (Prisma profile) or null.
  getCurrentUser: async (): Promise<CurrentUserShape | null> => {
    const sessionUser = await SessionService.getSessionUser();
    if (!sessionUser) return null;
    const p = sessionUser.profile;
    return {
      id: p.id,
      authId: p.authId,
      name: p.name,
      email: p.email,
      role: p.role,
      planId: p.planId,
      status: p.status,
      emailVerified: p.emailVerified,
    };
  },

  isAuthenticated: async (): Promise<boolean> => {
    return SessionService.isAuthenticated();
  },
};
