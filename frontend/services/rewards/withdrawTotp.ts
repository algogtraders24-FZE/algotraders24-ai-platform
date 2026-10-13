// services/rewards/withdrawTotp.ts
// (Server only.) Authenticator-app check for a withdrawal. A member who has a verified authenticator app (TOTP) enters the 6-digit code from it
// on every withdrawal; Supabase checks it with the member's own session. Members without one use the emailed code instead.
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeCode } from "@/lib/rewards/withdrawCode";

/** The member's verified authenticator factor id, or null when they have none. */
export async function getTotpFactorId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return null;
  return data?.totp?.[0]?.id ?? null; // only VERIFIED factors are listed in .totp
}

export async function verifyTotp(factorId: string, typed: unknown): Promise<{ ok: true } | { ok: false; message: string }> {
  const code = normalizeCode(typed);
  if (!code) return { ok: false, message: "Enter the 6-digit code from your authenticator app." };
  const supabase = await createSupabaseServerClient();
  const challenge = await supabase.auth.mfa.challenge({ factorId });
  if (challenge.error) return { ok: false, message: "Could not start the check. Please try again." };
  const verify = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code });
  if (verify.error) return { ok: false, message: "That code is not right. Wait for the next code and try again." };
  return { ok: true };
}
