// services/auth/SessionService.ts
// Sprint 14C - Bridges Supabase Auth session <-> Prisma User profile.
// Server-side only. Returns the fully-resolved app user for the current session.
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { UserRepository, type UserEntity } from "@/repositories/UserRepository";

const userRepo = new UserRepository();

export interface SessionUser {
  authId: string;
  profile: UserEntity;
}

export class SessionService {
  // Returns the raw Supabase session (or null if not logged in).
  static async getSession() {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getSession();
    return data.session ?? null;
  }

  // Verifies the user with Supabase Auth server (secure — not just cookie trust),
  // then resolves/creates the matching Prisma profile. Null if not authenticated.
  static async getSessionUser(): Promise<SessionUser | null> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      return null;
    }

    const authUser = data.user;
    const email = authUser.email ?? "";
    const name = (authUser.user_metadata?.name as string) ?? "";
    const emailVerified = authUser.email_confirmed_at != null;

    // First-login provisioning: create Prisma profile if it doesn't exist yet.
    const profile = await userRepo.findOrCreateByAuth({
      authId: authUser.id,
      email,
      name,
      emailVerified,
    });

    return { authId: authUser.id, profile };
  }

  // Convenience: true if a valid authenticated user exists.
  static async isAuthenticated(): Promise<boolean> {
    const user = await SessionService.getSessionUser();
    return user != null;
  }

  // Convenience: role check for authorization.
  static async hasRole(role: "admin" | "user"): Promise<boolean> {
    const user = await SessionService.getSessionUser();
    return user?.profile.role === role;
  }
}
