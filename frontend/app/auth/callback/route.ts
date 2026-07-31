// app/auth/callback/route.ts
// Sprint 14C - Email verification / OAuth / magic-link callback.
// Supabase redirects here after OAuth/confirmation. Exchange code -> session,
// provision profile, then redirect.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SessionService } from "@/services/auth/SessionService";
import { prisma } from "@/lib/prisma";
import { analyticsEventService } from "@/services/analytics/AnalyticsEventService";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const redirectTo = searchParams.get("redirectTo") ?? "/dashboard";

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Sprint R1.2 - Phase 2/3: real "login" + "email_verified" events.
      // Every path through this route (OAuth sign-in, signup confirmation,
      // magic link) represents a real session being established, so
      // "login" always fires here. "email_verified" only fires on the real
      // false->true transition - read the profile's PREVIOUS state before
      // getSessionUser() below updates it, so a user who was already
      // verified (e.g. every subsequent Google OAuth login) never gets a
      // second, false "email_verified" event. Best-effort throughout: never
      // blocks the redirect.
      const { data: authData } = await supabase.auth.getUser();
      const authId = authData.user?.id;
      const wasVerified = authId
        ? ((await prisma.user.findUnique({ where: { authId }, select: { emailVerified: true } }).catch(() => null))?.emailVerified ?? false)
        : false;

      const sessionUser = await SessionService.getSessionUser();
      if (sessionUser) {
        await analyticsEventService.record(sessionUser.profile.id, "login").catch(() => {});
        if (!wasVerified && sessionUser.profile.emailVerified) {
          await analyticsEventService.record(sessionUser.profile.id, "email_verified").catch(() => {});
        }
      }

      return NextResponse.redirect(`${origin}${redirectTo}`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
