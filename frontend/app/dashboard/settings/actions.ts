"use server";
// app/dashboard/settings/actions.ts
// Settings previously had no way to change anything - just a read-only
// account card plus sign-out (see that page's own header comment: it was
// deliberately built as "real information, not settings that don't yet do
// anything"). These two actions are the real thing: updating your display
// name, and changing your password from an active session (not the
// recovery-link flow resetPasswordAction handles - AuthService
// .updatePassword works the same way against either a regular or a
// recovery session, so it's reused as-is here).
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { AuthService } from "@/services/auth/AuthService";
import { SessionService } from "@/services/auth/SessionService";
import { sendPasswordChangedEmail } from "@/services/notifications/EmailService";
import type { ActionState } from "@/app/(auth)/actions/auth.actions";

export async function updateNameAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const sessionUser = await SessionService.getSessionUser();
  if (!sessionUser) {
    return { error: "You must be signed in to update your name." };
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { error: "Name is required." };
  }
  if (name.length > 100) {
    return { error: "Name must be 100 characters or fewer." };
  }

  await prisma.user.update({ where: { id: sessionUser.profile.id }, data: { name } });
  revalidatePath("/dashboard/settings");
  return { success: true, message: "Name updated." };
}

export async function changePasswordAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const sessionUser = await SessionService.getSessionUser();
  if (!sessionUser) {
    return { error: "You must be signed in to change your password." };
  }

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
    return { error: result.error ?? "Could not change your password." };
  }

  if (result.email) {
    try {
      await sendPasswordChangedEmail({ to: result.email });
    } catch (error) {
      console.error("[settings] password changed email failed:", error);
    }
  }

  return { success: true, message: "Password changed." };
}

export async function changeEmailAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const sessionUser = await SessionService.getSessionUser();
  if (!sessionUser) {
    return { error: "You must be signed in to change your email." };
  }

  const newEmail = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!newEmail || !newEmail.includes("@")) {
    return { error: "Enter a valid email address." };
  }
  if (newEmail === sessionUser.profile.email) {
    return { error: "That's already your current email address." };
  }

  const result = await AuthService.changeEmail(newEmail);
  if (!result.success) {
    return { error: result.error ?? "Could not change your email." };
  }

  // Not applied yet - Supabase requires clicking the confirmation link sent
  // to the new address first (see AuthService.changeEmail's own comment).
  // User.email is updated once that confirmation completes, not here.
  return { success: true, message: `Check ${newEmail} for a confirmation link to finish changing your email.` };
}
