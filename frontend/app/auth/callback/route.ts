// app/auth/callback/route.ts
// Sprint 14C - Email verification / OAuth / magic-link callback (foundation).
// Supabase redirects here after the user clicks a confirmation or reset link.
// We exchange the code for a session, provision the profile, then redirect.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SessionService } from "@/services/auth/SessionService";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const redirectTo = searchParams.get("redirectTo") ?? "/dashboard";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Ensure the Prisma profile exists and emailVerified is synced.
      await SessionService.getSessionUser();
      return NextResponse.redirect(`${origin}${redirectTo}`);
    }
  }

  // On failure, send the user back to login with a flag.
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
