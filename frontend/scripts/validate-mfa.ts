// scripts/validate-mfa.ts
// Two-factor gate policy (pure). Run: npx tsx scripts/validate-mfa.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

// Open redirect: /auth/callback builds `${origin}${redirectTo}`, so a value with no leading slash such as
// "@evil.example" would produce https://<our-host>@evil.example. A path with a query string must survive.
check("userinfo-style and non-path redirect targets are rejected", safeNext("@evil.example") === "/dashboard" && safeNext("evil.example") === "/dashboard" && safeNext("javascript:alert(1)") === "/dashboard");
check("a same-origin path keeps its query string", safeNext("/dashboard/support?handoff=abc123") === "/dashboard/support?handoff=abc123");

const root = join(__dirname, "..");
const callbackSrc = readFileSync(join(root, "app", "auth", "callback", "route.ts"), "utf8");
check("auth callback validates redirectTo with safeNext", /safeNext\(\s*searchParams\.get\("redirectTo"\)/.test(callbackSrc) && !/searchParams\.get\("redirectTo"\)\s*\?\?\s*"\/dashboard"/.test(callbackSrc));
const proxySrc = readFileSync(join(root, "proxy.ts"), "utf8");
check("auth gate keeps the query string in redirectTo (login and 2FA)", (proxySrc.match(/nextUrl\.search/g) ?? []).length >= 2 && !/searchParams\.set\("redirectTo",\s*pathname\)/.test(proxySrc));

console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
