// scripts/validate-pragya-guard.ts - PRAGYA answers are accepted only if they invent no number and make no promise.
// Run: npx tsx scripts/validate-pragya-guard.ts
import assert from "node:assert/strict";
import { cleanProse, containsForbiddenClaim, extractNumbers, numbersAreSupported } from "../lib/ai/pragya-guard";

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ok - ${name}`); } catch (e) { failed++; console.error(`  FAIL - ${name}\n    ${e instanceof Error ? e.message : String(e)}`); }
}

const FACTS = "Price 61,129.29 is above the EMA20 (59,588.49) and above the EMA50 (59,883.56). RSI(14) is 65.7. The latest structure break is a BOS bullish at 60,463.69. ATR(14) is 545.81, 0.89 % of price. The long plan waits for a retrace to 59,556 with the stop at 58,989 (1.0 ATR) and the target at 60,689 (2 R).";

test("extractNumbers: commas removed, tiny numbers ignored, decimals kept", () => {
  assert.deepEqual(extractNumbers("Price 61,129.29, RSI 65.7 and 2 sentences in 4 steps"), [61129.29, 65.7]);
});
test("a faithful answer passes (rounding within 0.5 % is fine)", () => {
  const a = "Price is 61,129 above the EMA20 at 59,588 and the EMA50 at 59,884, with RSI(14) at 65.7. The plan waits for 59,556, stop 58,989, target 60,689.";
  const r = numbersAreSupported(a, FACTS);
  assert.ok(r.ok, JSON.stringify(r));
});
test("an invented number is rejected", () => {
  const r = numbersAreSupported("Price is 61,129 and the next resistance sits at 63,500.", FACTS);
  assert.equal(r.ok, false);
  assert.deepEqual(r.unsupported, [63500]);
});
test("a number that is off by more than 0.5 % is rejected", () => {
  assert.equal(numbersAreSupported("The stop is at 58,000.", FACTS).ok, false);
});
test("promises and win-rate claims are flagged", () => {
  for (const bad of ["This trade is guaranteed to work.", "A sure shot entry.", "It is risk free.", "Expect a 70% win rate here.", "Price will definitely rise."]) assert.equal(containsForbiddenClaim(bad), true, bad);
});
test("plain educational wording passes the claim check", () => {
  assert.equal(containsForbiddenClaim("The plan is educational: a retrace to 59,556 with a stop at 58,989. Risk is one ATR."), false);
});
test("Hinglish promises and win-rate claims are flagged", () => {
  for (const bad of ["Ye trade pakka profit dega.", "Is setup mein loss nahi hoga.", "Yahan risk nahi hai.", "Isme 80% jeet ka chance hai.", "Paisa double ho jayega.", "Ye sure shot entry hai.", "Guarantee hai ki price badhega.", "यह पक्का मुनाफा है।"]) {
    assert.equal(containsForbiddenClaim(bad), true, bad);
  }
});
test("plain educational Hinglish passes the claim check", () => {
  assert.equal(containsForbiddenClaim("Price EMA20 ke upar hai, plan mein entry 59,556, stop 58,989 aur target 60,689 hai. Risk ek ATR ke barabar hai."), false);
  assert.equal(containsForbiddenClaim("Abhi wait karna sahi lagta hai kyunki nearest zone door hai."), false);
});
test("cleanProse strips markdown and joins lines", () => {
  assert.equal(cleanProse("**Price** is above\nthe `EMA20`.\n\n# Next"), "Price is above the EMA20. Next");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
