import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// TODO: enable auth checks once Supabase is integrated
export function middleware(_request: NextRequest) {
  // Future: read session, redirect unauthenticated users on protected routes
  // Protected: /dashboard, /admin, /account
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/account/:path*"],
};