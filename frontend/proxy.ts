// proxy.ts
// Sprint 14C auth logic - migrated from middleware.ts to Next 16 proxy convention.
// Logic UNCHANGED: Supabase session refresh + route guards. Only the file/function
// name changed per Next 16 (middleware -> proxy).
// NOTE (backlog security item): Next 16 "thin proxy" pattern recommends only a
// cookie-existence check here and full JWT verification in server components.
// getUser() JWT-verify is retained as-is for now to avoid re-architecting auth.
//
// AT24 Security Hardening P1.2 - nonce-based CSP was tried here and
// reverted. A per-request nonce (Next's own documented pattern, incl.
// 'strict-dynamic') was implemented and tested three separate ways -
// Turbopack on a static page, Turbopack on a genuinely dynamic page, and
// a webpack-fallback build - all three failed identically: Next 16.3.6
// does not attach the nonce to its own generated <script> tags (inline
// bootstrap AND external chunks alike), confirmed by directly running
// `next start` each time, not just `next build`. This matches a known,
// upstream-confirmed bug the Next.js team closed "not planned":
// https://github.com/vercel/next.js/issues/96063 - its own root-cause
// note: "the nonce value from the CSP request header is never
// propagated into the HTML output, despite proper middleware
// implementation following Next.js documentation." Given nonce-based CSP
// is not viable on this framework version, CSP moved back to
// next.config.ts's static headers() with script-src 'unsafe-inline'
// (see that file for the full directive list and reasoning) - this file
// no longer touches CSP at all.
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
//
// Publishing P2.3-E follow-up: the publishing dispatcher
// (/api/private/publishing/dispatch, a daily Vercel Cron) has the exact
// same session-less shape and was hitting this same 401 wall - its route
// checks isValidCronSecret() but the request never reached it. Added to
// the same exemption set on identical terms (valid cron secret only).
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isValidCronSecret } from "@/lib/intelligence/cron-auth";

// AT24 Security Hardening P2.1 - CSRF Origin validation. Defense-in-depth
// layered ON TOP OF SameSite=Lax cookies, which the P1 CSP research
// already confirmed is the actual primary CSRF defense here (cross-site
// POST/PUT/PATCH/DELETE requests don't carry the session cookie at all
// under SameSite=Lax) - this check is a second, independent layer, not
// the sole protection. Scoped to state-changing methods on
// /api/private/* only: GET reads are unaffected (not a CSRF concern),
// and this runs AFTER the cron-secret exemption below so Vercel Cron's
// Bearer-secret requests (not cookie-authenticated, not CSRF-vulnerable
// by definition) are untouched - same bypass point as the existing
// exemption, no new bypass mechanism introduced. A request with NO
// Origin header fails OPEN (allowed) - not because an absent header is
// "safe by definition", but because SameSite=Lax already closes that gap
// and rejecting on a merely-missing signal (some legitimate non-browser
// client, an edge-case browser) would risk breaking real traffic for a
// secondary defense layer. A PRESENT but mismatched Origin - the actual
// attack signature - is rejected with 403.
// Exported (only) for scripts/validate-csrf-origin.ts - real NextRequest
// instances, same logic the live proxy() function below actually runs,
// no separate reimplementation to drift out of sync.
export const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function hasDisallowedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://algotraders24.ai";
  try {
    return new URL(origin).origin !== new URL(siteUrl).origin;
  } catch {
    return true; // present but unparseable Origin - treat as mismatch, not absence
  }
}

const PROTECTED_PAGE_PREFIXES = ["/dashboard", "/admin", "/account"];
const PROTECTED_API_PREFIX = "/api/private";
const CRON_SECRET_EXEMPT_PATHS = new Set([
  "/api/private/admin/intelligence/evaluate-outcomes",
  "/api/private/admin/intelligence/ingest-news",
  "/api/private/publishing/dispatch",
  // AT24 Automation (MVP) - the per-slot dispatch crons. Keep in lockstep
  // with config/automation-slots.ts AUTOMATION_SLOTS[].dispatchPath and
  // frontend/vercel.json. Same terms: valid cron secret only.
  "/api/private/automations/cron/dispatch/morning-ist",
  "/api/private/automations/cron/dispatch/evening-ist",
]);

export async function proxy(request: NextRequest) {
  if (CRON_SECRET_EXEMPT_PATHS.has(request.nextUrl.pathname) && isValidCronSecret(request)) {
    return NextResponse.next({ request });
  }

  const pathname = request.nextUrl.pathname;
  const isProtectedApi = pathname.startsWith(PROTECTED_API_PREFIX);

  if (isProtectedApi && STATE_CHANGING_METHODS.has(request.method) && hasDisallowedOrigin(request)) {
    return NextResponse.json(
      { success: false, error: "Origin not allowed" },
      { status: 403 }
    );
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
  const isProtectedPage = PROTECTED_PAGE_PREFIXES.some((p) =>
    pathname.startsWith(p)
  );
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
