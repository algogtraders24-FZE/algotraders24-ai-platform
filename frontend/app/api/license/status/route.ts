// app/api/license/status/route.ts
// Sprint M11 - Runtime/buyer-facing read-only status check. GET requests
// cannot carry a JSON body, and the apiKey must never appear in a query
// string or URL (safety rule: never place sensitive data in URL params) -
// both licenseId and apiKey are passed as headers instead.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { getLicenseStatus } from "@/services/licensing/licenseService";

export const GET = withContext(async (req, ctx) => {
  const licenseId = req.headers.get("x-license-id");
  const apiKey = req.headers.get("x-license-api-key");
  if (!licenseId || !apiKey) {
    return ApiResponse.error({ code: "VALIDATION", message: "X-License-Id and X-License-Api-Key headers are required." }, ctx.requestId, 400, ctx.startedAt);
  }

  const result = await getLicenseStatus({ licenseId, rawApiKey: apiKey });
  if (!result.ok) {
    return ApiResponse.error({ code: "UNAUTHORIZED", message: "Invalid licenseId or apiKey." }, ctx.requestId, 401, ctx.startedAt);
  }

  return ApiResponse.success(
    {
      licenseId: result.licenseId,
      licenseStatus: result.licenseStatus,
      issuedAt: result.issuedAt,
      expiresAt: result.expiresAt,
      activationsUsed: result.activationsUsed,
      activationsAllowed: result.activationsAllowed,
      revokedAt: result.revokedAt,
      revokedReason: result.revokedReason,
    },
    ctx.requestId,
    200,
    ctx.startedAt,
  );
});
