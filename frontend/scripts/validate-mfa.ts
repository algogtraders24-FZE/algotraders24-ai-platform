// scripts/validate-mfa.ts
// Two-factor gate policy (pure). Run: npx tsx scripts/validate-mfa.ts
import { mfaDecision, mfaEnforced, normalizeTotp, safeNext } from "../lib/auth/mfa";

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}

check("off by default: nobody is challenged", !mfaEnforced(undefined) && !mfaEnforced("") && !mfaEnforced("1") && mfaDecision({ currentLevel: "aal1", nextLevel: "aal2" }, false) === "allow");
check("enforced only when exactly 'true'", mfaEnforced("true") && mfaEnforced(" TRUE "));
check("enrolled user at aal1 is challenged", mfaDecision({ currentLevel: "aal1", nextLevel: "aal2" }, true) === "challenge");
check("enrolled user who passed the code (aal2) is allowed", mfaDecision({ currentLevel: "aal2", nextLevel: "aal2" }, true) === "allow");
check("user without a factor is never challenged", mfaDecision({ currentLevel: "aal1", nextLevel: "aal1" }, true) === "allow");
check("missing levels never challenge (no accidental lockout)", mfaDecision({ currentLevel: null, nextLevel: null }, true) === "allow" && mfaDecision({ currentLevel: undefined, nextLevel: undefined }, true) === "allow");
check("a code is exactly six digits, spaces ignored", normalizeTotp("123456") === "123456" && normalizeTotp(" 123 456 ") === "123456" && normalizeTotp("12345") === null && normalizeTotp("1234567") === null && normalizeTotp("12a456") === null && normalizeTotp("") === null);
check("redirect target must be a same-origin path", safeNext("/dashboard/x") === "/dashboard/x" && safeNext("//evil.com") === "/dashboard" && safeNext("https://evil.com") === "/dashboard" && safeNext("/" + String.fromCharCode(92) + "evil.com") === "/dashboard" && safeNext(null) === "/dashboard" && safeNext("") === "/dashboard");

console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
