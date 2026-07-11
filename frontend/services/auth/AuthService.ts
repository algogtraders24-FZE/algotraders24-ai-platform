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

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
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

  static async forgotPassword(email: string): Promise<AuthResult> {
    const supabase = await createSupabaseServerClient();

    const { error } = await supabase.auth.resetPasswordForEmail(email);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, email };
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
