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
