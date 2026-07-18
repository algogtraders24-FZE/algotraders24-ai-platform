// proxy.ts
// Sprint 14C auth logic - migrated from middleware.ts to Next 16 proxy convention.
// Logic UNCHANGED: Supabase session refresh + route guards. Only the file/function
// name changed per Next 16 (middleware -> proxy). config.matcher stays identical.
// NOTE (backlog security item): Next 16 "thin proxy" pattern recommends only a
// cookie-existence check here and full JWT verification in server components.
// getUser() JWT-verify is retained as-is for now to avoid re-architecting auth.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PROTECTED_PAGE_PREFIXES = ["/dashboard", "/admin", "/account"];
const PROTECTED_API_PREFIX = "/api/private";

export async function proxy(request: NextRequest) {
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
