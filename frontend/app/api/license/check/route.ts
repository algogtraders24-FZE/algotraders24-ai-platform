// app/api/license/check/route.ts
// SIMPLE licensing: one key string in, one answer out. Runtime-facing like the other /api/license/* routes (no browser
// session - the key itself is the credential), so it is deliberately NOT under /api/private.
//   POST { "key": "AT24-<licenseId>.<secret>", "account": "12345678", "server": "Broker-Server", "product": "XXXUS30", "requireAccount": false }
//   -> { status:"ok", data:{ valid, reason?, detail?, buyerId, product, expiresAt, activations, accountBound, modelKey? } }
//   "wantModel": true (EAs that ship an encrypted model) also returns data.modelKey for a VALID check - see services/licensing/modelKey.ts
// A well-formed request always gets HTTP 200 with data.valid true/false (an EA only has to look at data.valid); malformed
// JSON gets 400. Fail-closed: anything unexpected is valid:false.
import { withContext } from "@/services/backend/Middleware";
import { ApiResponse } from "@/services/backend/ApiResponse";
import { checkLicenseByKey } from "@/services/licensing/licenseService";
import { cleanAccount, cleanBuild, cleanProduct, cleanServer } from "@/services/licensing/licenseKey";
import { modelKeyFor } from "@/services/licensing/modelKey";

export const POST = withContext(async (req, ctx) => {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || typeof body.key !== "string") {
    return ApiResponse.error({ code: "VALIDATION", message: 'JSON body with a "key" string is required.' }, ctx.requestId, 400, ctx.startedAt);
  }
  const account = cleanAccount(body.account);
  if (body.account !== undefined && body.account !== "" && body.account !== null && !account) {
    return ApiResponse.error({ code: "VALIDATION", message: '"account" must be a short plain account number/identifier.' }, ctx.requestId, 400, ctx.startedAt);
  }
  const product = cleanProduct(body.product);
  if (body.product !== undefined && body.product !== "" && body.product !== null && !product) {
    return ApiResponse.error({ code: "VALIDATION", message: '"product" must be a short plain product id.' }, ctx.requestId, 400, ctx.startedAt);
  }
  const result = await checkLicenseByKey({ key: body.key, account, server: cleanServer(body.server), requireAccount: body.requireAccount === true, product, build: cleanBuild(body.build) });
  // An EA that ships an encrypted model asks for its key ("wantModel": true). Only a VALID check of the matching product gets it.
  if (result.valid && body.wantModel === true && result.product) {
    let modelKey: string | null = null;
    try {
      modelKey = modelKeyFor(result.product.tradingSystemId);
    } catch {
      modelKey = null; // misconfigured server: the EA simply runs without its model, it never receives a wrong key
    }
    if (modelKey) return ApiResponse.success({ ...result, modelKey }, ctx.requestId, 200, ctx.startedAt);
  }
  return ApiResponse.success(result, ctx.requestId, 200, ctx.startedAt);
});
