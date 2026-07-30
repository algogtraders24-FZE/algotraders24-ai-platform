// Sprint 14C - AuthService: wraps Supabase Auth operations.
// Server-side only. Uses the SSR server client (cookie-based sessions).
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AuthResult {
  success: boolean;
  error?: string;
  userId?: string;
  email?: string;
}

export class AuthService {
  static async signUp(
    email: string,
    password: string,
    name: string
  ): Promise<AuthResult> {
    const supabase = await createSupabaseServerClient();
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
        // Sprint R1.0.1 - previously unset, so the confirmation email fell
        // back to whatever Site URL is configured in the Supabase project
        // dashboard rather than this app's own callback route. Explicit
        // here means the confirmation link always exchanges into a real
        // session and lands the user logged in on /dashboard, using the
        // same callback route every other auth flow already relies on.
        emailRedirectTo: `${baseUrl}/auth/callback?redirectTo=${encodeURIComponent("/dashboard")}`,
      },
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      userId: data.user?.id,
      email: data.user?.email ?? undefined,
    };
  }

  // Sprint R1.0.1 - lets an already-registered, not-yet-verified user get a
  // fresh confirmation email (e.g. the first one expired or was lost) -
  // previously there was no way to do this short of signing up again.
  static async resendVerificationEmail(email: string): Promise<AuthResult> {
    const supabase = await createSupabaseServerClient();
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo: `${baseUrl}/auth/callback?redirectTo=${encodeURIComponent("/dashboard")}`,
      },
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, email };
  }

  static async signIn(email: string, password: string): Promise<AuthResult> {
    const supabase = await createSupabaseServerClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      userId: data.user?.id,
      email: data.user?.email ?? undefined,
    };
  }

  static async signOut(): Promise<AuthResult> {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signOut();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  }

  // Sprint R1.0.1 - redirectTo now points at the real reset-password page
  // via the existing OAuth/confirmation callback route (/auth/callback
  // already exchanges the recovery code for a session and honors
  // ?redirectTo=). Previously this had no redirectTo at all, so the
  // emailed link had nowhere real to land - the request always "worked"
  // but the flow could never be completed.
  static async forgotPassword(email: string): Promise<AuthResult> {
    const supabase = await createSupabaseServerClient();
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${baseUrl}/auth/callback?redirectTo=${encodeURIComponent("/reset-password")}`,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, email };
  }

  // Sprint R1.0.1 - completes the password reset. Requires an active
  // (recovery) session, established by the /auth/callback exchange above -
  // never callable without first following a real, valid reset link.
  static async updatePassword(newPassword: string): Promise<AuthResult> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, userId: data.user?.id, email: data.user?.email ?? undefined };
  }

  static async getCurrentAuthUser(): Promise<{
    id: string;
    email: string | undefined;
    name: string | undefined;
    emailVerified: boolean;
  } | null> {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      return null;
    }

    return {
      id: data.user.id,
      email: data.user.email,
      name: (data.user.user_metadata?.name as string) ?? undefined,
      emailVerified: data.user.email_confirmed_at != null,
    };
  }
}
