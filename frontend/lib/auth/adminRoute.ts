// lib/auth/adminRoute.ts
// Sprint L2.6 - Shared admin-only gate for /api/private/admin/* route
// handlers. Every admin route calls this first; none of them proceeds to
// read or write anything until it returns ok:true. Built on the existing,
// already-real assertRole("admin") primitive (lib/auth/protectedRoute.ts)
// rather than a new auth mechanism - that primitive existed, correctly
// implemented, but was never actually called by any route before this
// sprint (see the L2.6 audit).
import { NextResponse } from "next/server";
import { assertRole } from "./protectedRoute";
import { ApiResponse } from "@/services/backend/ApiResponse";
import type { SessionUser } from "@/services/auth/SessionService";

export type AdminGateResult =
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse };

export async function requireAdmin(requestId: string, startedAt: number): Promise<AdminGateResult> {
  const result = await assertRole("admin");
  if (!result.ok) {
    const message = result.status === 401 ? "Authentication required" : "Admin authorization required";
    return {
      ok: false,
      response: ApiResponse.error(
        { code: result.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN", message },
        requestId,
        result.status,
        startedAt,
      ),
    };
  }
  return { ok: true, user: result.user };
}
