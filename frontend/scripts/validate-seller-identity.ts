// scripts/validate-seller-identity.ts
// Seller identity verification (Sumsub): webhook signature, verdict mapping, request signing, enforcement flag.
// Pure - no database, no network. Run: npx tsx scripts/validate-seller-identity.ts
import { createHmac } from "node:crypto";
import { identityRequired, signSumsubRequest, sumsubConfigured, verdictFromWebhook, verifyWebhookSignature } from "../lib/marketplace/identity";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
}

// --- webhook signature
const secret = "whsec_test_secret_123";
const body = JSON.stringify({ type: "applicantReviewed", externalUserId: "u1", reviewResult: { reviewAnswer: "GREEN" } });
const sig256 = createHmac("sha256", secret).update(body).digest("hex");
const sig512 = createHmac("sha512", secret).update(body).digest("hex");
const sig1 = createHmac("sha1", secret).update(body).digest("hex");
check("valid SHA256 signature accepted", verifyWebhookSignature(body, sig256, "HMAC_SHA256_HEX", secret));
check("valid SHA512 signature accepted", verifyWebhookSignature(body, sig512, "HMAC_SHA512_HEX", secret));
check("legacy SHA1 refused even when correct", !verifyWebhookSignature(body, sig1, "HMAC_SHA1_HEX", secret));
check("wrong secret refused", !verifyWebhookSignature(body, sig256, "HMAC_SHA256_HEX", "other-secret"));
check("a changed body refused", !verifyWebhookSignature(body.replace("u1", "u2"), sig256, "HMAC_SHA256_HEX", secret));
check("missing / unknown algorithm refused", !verifyWebhookSignature(body, sig256, null, secret) && !verifyWebhookSignature(body, sig256, "MD5", secret));
check("missing digest or empty secret refused", !verifyWebhookSignature(body, null, "HMAC_SHA256_HEX", secret) && !verifyWebhookSignature(body, sig256, "HMAC_SHA256_HEX", ""));
check("upper-case digest and lower-case algorithm tolerated", verifyWebhookSignature(body, sig256.toUpperCase(), "hmac_sha256_hex", secret));
check("a digest of the wrong length is refused (no throw)", !verifyWebhookSignature(body, "abc", "HMAC_SHA256_HEX", secret));

// --- verdicts
const green = { type: "applicantReviewed", applicantId: "a1", externalUserId: "user-1", reviewStatus: "completed", reviewResult: { reviewAnswer: "GREEN" } };
const v = verdictFromWebhook(green);
check("GREEN -> VERIFIED for OUR user id", v?.status === "VERIFIED" && v.userId === "user-1" && v.applicantId === "a1");
check("RED + RETRY -> RETRY", verdictFromWebhook({ ...green, reviewResult: { reviewAnswer: "RED", reviewRejectType: "RETRY" } })?.status === "RETRY");
check("RED + FINAL -> REJECTED", verdictFromWebhook({ ...green, reviewResult: { reviewAnswer: "RED", reviewRejectType: "FINAL" } })?.status === "REJECTED");
check("RED with no type defaults to the softer RETRY", verdictFromWebhook({ ...green, reviewResult: { reviewAnswer: "RED" } })?.status === "RETRY");
check("other events are ignored", verdictFromWebhook({ ...green, type: "applicantPending" }) === null && verdictFromWebhook({ ...green, type: "applicantCreated" }) === null);
check("an unfinished review is ignored", verdictFromWebhook({ ...green, reviewStatus: "pending" }) === null);
check("no external user id -> ignored", verdictFromWebhook({ ...green, externalUserId: "" }) === null && verdictFromWebhook({ type: "applicantReviewed", reviewResult: { reviewAnswer: "GREEN" } }) === null);
check("unknown answer -> ignored", verdictFromWebhook({ ...green, reviewResult: { reviewAnswer: "YELLOW" } }) === null);
check("garbage payloads -> ignored", verdictFromWebhook(null) === null && verdictFromWebhook("x") === null && verdictFromWebhook([]) === null);

// --- request signing (scheme from the Sumsub docs: ts + METHOD + path + body, HMAC-SHA256, hex)
const reqSig = signSumsubRequest("sk", "1607551635", "post", "/resources/accessTokens/sdk", '{"ttlInSecs":600}');
const expected = createHmac("sha256", "sk").update('1607551635POST/resources/accessTokens/sdk{"ttlInSecs":600}').digest("hex");
check("request signature = HMAC-SHA256(ts + METHOD + path + body)", reqSig === expected && /^[0-9a-f]{64}$/.test(reqSig));
check("the method is upper-cased before signing", signSumsubRequest("sk", "1", "get", "/x", "") === signSumsubRequest("sk", "1", "GET", "/x", ""));
check("the query string is part of the signed path", signSumsubRequest("sk", "1", "GET", "/x?a=1", "") !== signSumsubRequest("sk", "1", "GET", "/x", ""));

// --- switches
check("enforcement is OFF unless explicitly 'true'", !identityRequired(undefined) && !identityRequired("") && !identityRequired("1") && identityRequired("true") && identityRequired(" TRUE "));
check("provider counts as configured only with all three secrets", !sumsubConfigured({}) && !sumsubConfigured({ SUMSUB_APP_TOKEN: "a", SUMSUB_SECRET_KEY: "b" }) && sumsubConfigured({ SUMSUB_APP_TOKEN: "a", SUMSUB_SECRET_KEY: "b", SUMSUB_WEBHOOK_SECRET: "c" }));

console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
