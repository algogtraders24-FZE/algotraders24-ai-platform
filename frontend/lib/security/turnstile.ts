// lib/security/turnstile.ts
// Sprint R1.3 - Cloudflare Turnstile verification for the signup form.
// Verified independently of Supabase (a direct call to Cloudflare's
// siteverify endpoint) so it works without touching Supabase Auth dashboard
// settings. Enforcement is gated on TURNSTILE_SECRET_KEY being configured:
// until real Cloudflare keys are added, this no-ops (open) rather than
// locking out real signups - the DB rate limit + honeypot still apply in the
// meantime. Set TURNSTILE_SECRET_KEY (and NEXT_PUBLIC_TURNSTILE_SITE_KEY) to
// turn on enforcement.
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstileToken(token: string | null, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.warn("[turnstile] TURNSTILE_SECRET_KEY not set - CAPTCHA check is disabled.");
    return true;
  }

  if (!token) {
    return false;
  }

  try {
    const response = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
    });

    if (!response.ok) return false;
    const data = (await response.json()) as { success: boolean };
    return data.success === true;
  } catch (error) {
    console.error("[turnstile] verification request failed:", error);
    // Fail closed: a broken verification call should not silently let bots
    // through once CAPTCHA is meant to be enforced.
    return false;
  }
}

export function isTurnstileConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
}
