// proxy.ts
// Sprint 14C auth logic - migrated from middleware.ts to Next 16 proxy convention.
// Logic UNCHANGED: Supabase session refresh + route guards. Only the file/function
// name changed per Next 16 (middleware -> proxy). config.matcher stays identical.
// NOTE (backlog security item): Next 16 "thin proxy" pattern recommends only a
// cookie-existence check here and full JWT verification in server components.
// getUser() JWT-verify is retained as-is for now to avoid re-architecting auth.
//
// Infrastructure fix discovered during AN1.7 E2E validation: this file's
// Supabase-session gate (Sprint 14C/15A, predates D2.7.9/D2.7.10's cron-
// secret design by many sprints) unconditionally 401'd every /api/private/*
// request with no Supabase session - including Vercel Cron's own real
// invocations, which carry no session at all. That silently made both
// evaluate-outcomes' and ingest-news's documented "Authorization: Bearer
// <cron secret>" auth contract unreachable in production: the request never
// got past this gate to reach isValidCronSecret() inside the route. Fixed
// with the smallest possible additive exemption - NOT a generic Bearer
// bypass: only these two exact, pre-existing cron-triggered paths, and only
// when the presented Bearer credential is the exact configured cron secret
// (isValidCronSecret - the same constant-time check the routes themselves
// already use, not a second implementation). Every other path, and these
// two paths without a valid cron secret, fall through to the unchanged
// Supabase session check below.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isValidCronSecret } from "@/lib/intelligence/cron-auth";

const PROTECTED_PAGE_PREFIXES = ["/dashboard", "/admin", "/account"];
const PROTECTED_API_PREFIX = "/api/private";
const CRON_SECRET_EXEMPT_PATHS = new Set([
  "/api/private/admin/intelligence/evaluate-outcomes",
  "/api/private/admin/intelligence/ingest-news",
]);

export async function proxy(request: NextRequest) {
  if (CRON_SECRET_EXEMPT_PATHS.has(request.nextUrl.pathname) && isValidCronSecret(request)) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return response;
  }
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;
  const isProtectedPage = PROTECTED_PAGE_PREFIXES.some((p) =>
    pathname.startsWith(p)
  );
  const isProtectedApi = pathname.startsWith(PROTECTED_API_PREFIX);
  if (!user && isProtectedApi) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  if (!user && isProtectedPage) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(loginUrl);
  }
  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/admin/:path*",
    "/account/:path*",
    "/api/private/:path*",
  ],
};
