// app/(auth)/actions/auth.actions.ts
// Sprint 14C - Server Actions for auth forms.
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AuthService } from "@/services/auth/AuthService";
import { SessionService } from "@/services/auth/SessionService";

export interface ActionState {
  error?: string;
  success?: boolean;
  message?: string;
}

export async function signUpAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  if (!email || !password || !name) {
    return { error: "All fields are required." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const result = await AuthService.signUp(email, password, name);
  if (!result.success) {
    return { error: result.error ?? "Sign up failed." };
  }

  // Provision the Prisma profile immediately (also happens on first login).
  await SessionService.getSessionUser();

  return {
    success: true,
    message:
      "Account created. Please check your email to verify your address, then log in.",
  };
}

export async function signInAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const result = await AuthService.signIn(email, password);
  if (!result.success) {
    return { error: result.error ?? "Invalid credentials." };
  }

  // Ensure the Prisma profile exists / is linked on first login.
  await SessionService.getSessionUser();

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  await AuthService.signOut();
  revalidatePath("/");
  redirect("/login");
}

export async function forgotPasswordAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) {
    return { error: "Email is required." };
  }

  const result = await AuthService.forgotPassword(email);
  if (!result.success) {
    return { error: result.error ?? "Could not send reset email." };
  }

  return {
    success: true,
    message: "If that email exists, a password reset link has been sent.",
  };
}

// Sprint R1.0.1 - Lets an already-authenticated, not-yet-verified user
// request a fresh confirmation email. Scoped to the current session's own
// email (never a client-supplied address) so this can't be used to spam
// arbitrary inboxes.
export async function resendVerificationAction(
  _prev: ActionState
): Promise<ActionState> {
  void _prev; // required by useActionState's action signature, unused here
  const sessionUser = await SessionService.getSessionUser();
  if (!sessionUser?.profile.email) {
    return { error: "You must be signed in to resend a verification email." };
  }

  const result = await AuthService.resendVerificationEmail(sessionUser.profile.email);
  if (!result.success) {
    return { error: result.error ?? "Could not resend verification email." };
  }

  return { success: true, message: "Verification email sent - check your inbox." };
}

// Sprint R1.0.1 - Completes the password reset flow started by
// forgotPasswordAction. Requires an active recovery session (established by
// /auth/callback after the user clicks the real emailed link) - AuthService
// .updatePassword will fail with a real Supabase error otherwise, which is
// surfaced here rather than assumed away.
export async function resetPasswordAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!password || !confirmPassword) {
    return { error: "Both fields are required." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (password !== confirmPassword) {
    return { error: "Passwords do not match." };
  }

  const result = await AuthService.updatePassword(password);
  if (!result.success) {
    return {
      error:
        result.error ??
        "Could not reset your password. Your reset link may have expired - request a new one.",
    };
  }

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

// Sprint 14C+ - Google OAuth sign-in.
export async function signInWithGoogleAction(): Promise<void> {
  const { createSupabaseServerClient } = await import("@/lib/supabase/server");
  const supabase = await createSupabaseServerClient();

  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${baseUrl}/auth/callback`,
    },
  });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  if (data?.url) {
    redirect(data.url);
  }
}
