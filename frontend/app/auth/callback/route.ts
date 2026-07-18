// app/auth/callback/route.ts
// Sprint 14C - Email verification / OAuth / magic-link callback.
// Supabase redirects here after OAuth/confirmation. Exchange code -> session,
// provision profile, then redirect.
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
      await SessionService.getSessionUser();
      return NextResponse.redirect(`${origin}${redirectTo}`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
