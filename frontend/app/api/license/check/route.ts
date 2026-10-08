// app/api/license/check/route.ts
// SIMPLE licensing: one key string in, one answer out. Runtime-facing like the other /api/license/* routes (no browser
// session - the key itself is the credential), so it is deliberately NOT under /api/private.
//   POST { "key": "AT24-<licenseId>.<secret>", "account": "12345678", "server": "Broker-Server", "requireAccount": false }
//   -> { status:"ok", data:{ valid, reason?, detail?, buyerId, product, expiresAt, activations, accountBound } }
// A well-formed request always gets HTTP 200 with data.valid true/false (an EA only has to look at data.valid); malformed
// JSON gets 400. Fail-closed: anything unexpected is valid:false.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { checkLicenseByKey } from "@/services/licensing/licenseService";
import { cleanAccount, cleanServer } from "@/services/licensing/licenseKey";

export const POST = withContext(async (req, ctx) => {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || typeof body.key !== "string") {
    return ApiResponse.error({ code: "VALIDATION", message: 'JSON body with a "key" string is required.' }, ctx.requestId, 400, ctx.startedAt);
  }
  const account = cleanAccount(body.account);
  if (body.account !== undefined && body.account !== "" && body.account !== null && !account) {
    return ApiResponse.error({ code: "VALIDATION", message: '"account" must be a short plain account number/identifier.' }, ctx.requestId, 400, ctx.startedAt);
  }
  const result = await checkLicenseByKey({ key: body.key, account, server: cleanServer(body.server), requireAccount: body.requireAccount === true });
  return ApiResponse.success(result, ctx.requestId, 200, ctx.startedAt);
});
