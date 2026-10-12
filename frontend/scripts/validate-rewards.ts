// scripts/validate-rewards.ts
// Rewards & Partner Program, Phase 1: the pure rules (money schedule, eligibility, freeze, balances, reserve, slots, flags, copy).
// No database, no network. Run: npx tsx scripts/validate-rewards.ts
import {
  REWARD_PRODUCTS, REWARD_PRODUCT_KEYS, HOLD_DAYS, MIN_PAYOUT_CENTS, BANNED_COPY_WORDS,
  rewardsMode, multiLevelReferralEnabled, withdrawalsEnabled, isRewardProductKey,
} from "../lib/rewards/config";
import { bps, formatUsd, addMonths, computeContractMoney, computeReferralShares, assertProductSane, maxOutflowCents } from "../lib/rewards/money";
import { isProActive, programOpenFor, canBuyContract, decideInstalment, canWithdraw, canEarnReferral, type UserFacts } from "../lib/rewards/eligibility";
import { bucketOf, summarizeBalances, summarizeReserve, reserveShortfall, ledgerKey } from "../lib/rewards/ledger";
import { badgeFor, displayNameWithBadge, BADGE_TIERS } from "../lib/rewards/badge";
import { buildContractPdf, contractClauses, type ContractPdfInput } from "../lib/rewards/contractPdf";
import { contractStatusAfter, unreleasedCents, purchaseVoided } from "../lib/rewards/lifecycle";
import { guideText, GUIDE_SECTIONS, GUIDE_FAQ, QUICK_START, GUIDE_PATH } from "../lib/rewards/guide";
import { contractEmailBody, contractEmailSubject, escapeHtmlText } from "../lib/rewards/emailContent";
import { buildProductVM } from "../lib/rewards/viewModel";
import { monthKey, slotsRemaining, holdExpiry, validateSlotLimits, isMonthKey } from "../lib/rewards/slots";
import { generateReferralCode, normalizeReferralCode, referralLink, CODE_ALPHABET, REF_COOKIE, REF_COOKIE_MAX_AGE_SECONDS, REFERRAL_LANDING_PATH } from "../lib/rewards/referral";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
}

const NOW = new Date("2026-11-01T00:00:00Z");
const future = new Date("2026-12-01T00:00:00Z");
const past = new Date("2026-10-01T00:00:00Z");

// --- products and the agreed numbers
const btc = REWARD_PRODUCTS.BTC_AI_ALGO, gold = REWARD_PRODUCTS.GOLD_AI_ALGO, idx = REWARD_PRODUCTS.INDEX_AI_ALGO;
const mB = computeContractMoney(btc, NOW), mG = computeContractMoney(gold, NOW), mI = computeContractMoney(idx, NOW);
check("BTC: list 4,999 / rebate 2,000 / net 2,999 / 4 x 500", mB.listPriceCents === 499_900 && mB.rebateTotalCents === 200_000 && mB.netPriceCents === 299_900 && mB.schedule.every((s) => s.amountCents === 50_000) && mB.schedule.length === 4);
check("Gold: list 9,999 / rebate 5,000 / net 4,999 / 4 x 1,250", mG.rebateTotalCents === 500_000 && mG.netPriceCents === 499_900 && mG.schedule.every((s) => s.amountCents === 125_000));
check("Index: list 29,999 / rebate 18,000 / net 11,999 / 4 x 4,500", mI.rebateTotalCents === 1_800_000 && mI.netPriceCents === 1_199_900 && mI.schedule.every((s) => s.amountCents === 450_000));
check("reserve equals the whole rebate", mB.reserveCents === mB.rebateTotalCents && mI.reserveCents === 1_800_000);
check("schedule always adds up to the rebate", [mB, mG, mI].every((m) => m.schedule.reduce((s, x) => s + x.amountCents, 0) === m.rebateTotalCents));
check("due dates are 90/180/270/360 days after purchase", mB.schedule.map((s) => Math.round((s.dueAt.getTime() - NOW.getTime()) / 86_400_000)).join() === "90,180,270,360");
check("12-month contract end", mB.endsAt.toISOString() === "2027-11-01T00:00:00.000Z");
check("last instalment falls inside the term", mB.schedule[3].dueAt.getTime() <= mB.endsAt.getTime());
check("rebate never reaches the price", REWARD_PRODUCT_KEYS.every((k) => REWARD_PRODUCTS[k].rebateCents < REWARD_PRODUCTS[k].listPriceCents));
check("rebate is about the agreed 40 / 50 / 60 percent", [[btc, 40], [gold, 50], [idx, 60]].every(([p, pct]) => { const r = (p as typeof btc).rebateCents / (p as typeof btc).listPriceCents * 100; return Math.abs(r - (pct as number)) < 0.05; }));
check("referral is about 2 / 1 / 1 / 1 percent of list", REWARD_PRODUCT_KEYS.every((k) => { const p = REWARD_PRODUCTS[k]; return p.referralCents.every((c, i) => Math.abs(c / p.listPriceCents * 100 - [2, 1, 1, 1][i]) < 0.05); }));
check("net price is below list price but positive", REWARD_PRODUCT_KEYS.every((k) => { const m = computeContractMoney(REWARD_PRODUCTS[k], NOW); return m.netPriceCents > 0 && m.netPriceCents < m.listPriceCents; }));

// odd amount: the remainder cent goes to the last instalment, total stays exact
const odd = { ...btc, listPriceCents: 1_000_001, rebateCents: 400_001, referralCents: [0, 0, 0, 0] as [number, number, number, number] };
const mo = computeContractMoney(odd, NOW);
check("odd price: exact total, no lost cent", mo.schedule.reduce((s, x) => s + x.amountCents, 0) === mo.rebateTotalCents);
const odd2 = { ...btc, listPriceCents: 1_000_003, rebateCents: 333_333, referralCents: [0, 0, 0, 0] as [number, number, number, number] };
const mo2 = computeContractMoney(odd2, NOW);
check("uneven split: last instalment takes the remainder", mo2.schedule.reduce((s, x) => s + x.amountCents, 0) === mo2.rebateTotalCents && mo2.schedule[3].amountCents >= mo2.schedule[0].amountCents);

// unsafe configurations are refused
const bad = (p: Partial<typeof btc>) => { try { assertProductSane({ ...btc, ...p }); return false; } catch { return true; } };
check("config guards", bad({ rebateCents: btc.listPriceCents }) && bad({ rebateCents: -1 }) && bad({ rebateCents: btc.listPriceCents - 100 }) && bad({ referralCents: [-1, 0, 0, 0] }) && bad({ listPriceCents: 0 }) && bad({ installments: 0 }) && bad({ intervalDays: 0 }) && bad({ installments: 6 }) && bad({ listPriceCents: 10.5 }));

// --- helpers
check("bps rounds to the cent", bps(100_001, 4000) === 40_000 && bps(499_900, 200) === 9_998);
check("formatUsd", formatUsd(299_900) === "$2,999.00" && formatUsd(5) === "$0.05" && formatUsd(-150) === "-$1.50");
check("addMonths clamps the day", addMonths(new Date("2026-01-31T00:00:00Z"), 1).toISOString() === "2026-02-28T00:00:00.000Z");
check("product keys", isRewardProductKey("BTC_AI_ALGO") && !isRewardProductKey("btc") && !isRewardProductKey(5));

// --- referral
const up = ["seller", "l1", "l2", "l3"];
const r1 = computeReferralShares(btc, "buyer", up, false);
check("multi-level OFF: only the direct seller is paid", r1.length === 1 && r1[0].partnerId === "seller" && r1[0].amountCents === 10_000);
const r4 = computeReferralShares(btc, "buyer", up, true);
check("multi-level ON: 2/1/1/1% of list", r4.length === 4 && r4.map((r) => r.amountCents).join() === "10000,5000,5000,5000");
check("flag defaults to OFF and only literal 'true' enables", !multiLevelReferralEnabled(undefined) && !multiLevelReferralEnabled("1") && !multiLevelReferralEnabled("yes") && multiLevelReferralEnabled("true"));
check("self-referral earns nothing", computeReferralShares(btc, "buyer", ["buyer", "l1"], true).every((r) => r.partnerId !== "buyer"));
check("same partner is never paid twice on one sale", computeReferralShares(btc, "buyer", ["a", "a", "b"], true).filter((r) => r.partnerId === "a").length === 1);
check("gaps in the upline are skipped", computeReferralShares(idx, "buyer", ["a", null, "c"], true).map((r) => r.level).join() === "0,2");
check("no seller, no commission", computeReferralShares(btc, "buyer", [], true).length === 0);
check("max outflow (rebate + direct referral), multi-level off", maxOutflowCents(btc, false) === 200_000 + 10_000 && maxOutflowCents(idx, false) === 1_800_000 + 60_000);
check("max outflow with all 4 levels = rebate + $1,500 on Index", maxOutflowCents(idx, true) === 1_800_000 + 150_000);

// --- eligibility
const pro = { planId: "pro", status: "active", currentPeriodEnd: future, provider: "nowpayments" as string | null };
const u = (o: Partial<UserFacts> = {}): UserFacts => ({ email: "buyer@example.com", subscription: pro, identity: "VERIFIED", ...o });
const ctx = { mode: "public" as const, allowlist: [], productEnabled: true, slotsRemaining: 3, now: NOW };
check("Pro active", isProActive(pro, NOW));
check("admin-granted Pro (no payment provider) does not qualify", !isProActive({ ...pro, provider: null }, NOW) && !canBuyContract(u({ subscription: { ...pro, provider: null } }), ctx).ok);
check("free plan, inactive, expired and no subscription are not Pro", !isProActive({ ...pro, planId: "free" }, NOW) && !isProActive({ ...pro, status: "canceled" }, NOW) && !isProActive({ ...pro, currentPeriodEnd: past }, NOW) && !isProActive(null, NOW));
check("eligible user can buy", canBuyContract(u(), ctx).ok);
const noKyc = canBuyContract(u({ identity: "PENDING" }), ctx);
check("KYC not verified blocks buying", !noKyc.ok && noKyc.reasons.some((r) => /KYC/.test(r)));
for (const s of ["NONE", "REJECTED", "RETRY", "PENDING"] as const) check(`identity ${s} blocks`, !canBuyContract(u({ identity: s }), ctx).ok);
check("no Pro blocks buying", !canBuyContract(u({ subscription: null }), ctx).ok);
check("no slots blocks buying", !canBuyContract(u(), { ...ctx, slotsRemaining: 0 }).ok);
check("disabled product blocks buying", !canBuyContract(u(), { ...ctx, productEnabled: false }).ok);
const multi = canBuyContract(u({ identity: "NONE", subscription: null }), { ...ctx, slotsRemaining: 0 });
check("every failing reason is listed for the checklist", !multi.ok && multi.reasons.length === 3);
check("mode off hides the program from normal users", !canBuyContract(u(), { ...ctx, mode: "off" }).ok && !programOpenFor("off", "x@y.com", []));
check("owner always allowed even when off", programOpenFor("off", "algogtraders24@gmail.com", []) && programOpenFor("off", "pravinawari@outlook.com", []));
check("allowlist mode", programOpenFor("allowlist", "A@Y.com", ["a@y.com"]) && !programOpenFor("allowlist", "b@y.com", ["a@y.com"]));
check("rollout mode defaults to off", rewardsMode(undefined) === "off" && rewardsMode("garbage") === "off" && rewardsMode("public") === "public");

// --- instalments: freeze, never forfeit
const active = { status: "ACTIVE" as const, endsAt: new Date("2027-11-01T00:00:00Z") };
check("eligible user: release", decideInstalment(active, u(), NOW).action === "RELEASE");
const f1 = decideInstalment(active, u({ subscription: { ...pro, currentPeriodEnd: past } }), NOW);
check("Pro lapsed: FREEZE (kept, not forfeited)", f1.action === "FREEZE");
check("KYC lost: FREEZE", decideInstalment(active, u({ identity: "RETRY" }), NOW).action === "FREEZE");
check("revoked contract: CANCEL", decideInstalment({ ...active, status: "REVOKED" }, u(), NOW).action === "CANCEL");
check("document not issued yet: FREEZE, not release", decideInstalment({ ...active, status: "PENDING_DOCUMENT" }, u(), NOW).action === "FREEZE");
check("a lapse never cancels", ["FROZEN", "ACTIVE", "ENDED"].every((s) => decideInstalment({ ...active, status: s as "ACTIVE" }, u({ subscription: null }), NOW).action !== "CANCEL"));

// --- withdrawal
const wOpts = { availableCents: 100_000, amountCents: 50_000, minCents: MIN_PAYOUT_CENTS, withdrawalsOn: true, now: NOW };
check("eligible withdrawal", canWithdraw(u(), wOpts).ok);
check("withdrawals switched off", !canWithdraw(u(), { ...wOpts, withdrawalsOn: false }).ok);
check("needs Pro", !canWithdraw(u({ subscription: null }), wOpts).ok);
check("needs KYC", !canWithdraw(u({ identity: "NONE" }), wOpts).ok);
check("below minimum", !canWithdraw(u(), { ...wOpts, amountCents: MIN_PAYOUT_CENTS - 1 }).ok && canWithdraw(u(), { ...wOpts, amountCents: MIN_PAYOUT_CENTS }).ok);
check("more than available", !canWithdraw(u(), { ...wOpts, amountCents: 100_001 }).ok);
check("bad amounts", !canWithdraw(u(), { ...wOpts, amountCents: 0 }).ok && !canWithdraw(u(), { ...wOpts, amountCents: -5 }).ok && !canWithdraw(u(), { ...wOpts, amountCents: 10.5 }).ok);
check("withdrawals default to OFF", !withdrawalsEnabled(undefined) && !withdrawalsEnabled("1") && withdrawalsEnabled("true"));
check("referral needs Pro + KYC", canEarnReferral(u(), NOW) && !canEarnReferral(u({ identity: "NONE" }), NOW) && !canEarnReferral(u({ subscription: null }), NOW));

// --- balances
const rel = new Date("2026-10-20T00:00:00Z");
const item = (o: Partial<{ amountCents: number; status: string; releasedAt: Date | null; payoutId: string | null }>) => ({ amountCents: 100, status: "RELEASED", releasedAt: rel, payoutId: null, ...o });
check(`inside the ${HOLD_DAYS}-day hold -> holding`, bucketOf(item({}), new Date("2026-10-25T00:00:00Z")) === "holding");
check("after the hold -> available", bucketOf(item({}), new Date("2026-10-28T00:00:00Z")) === "available");
check("reserved by a payout -> requested", bucketOf(item({ payoutId: "p" }), NOW) === "requested");
check("scheduled / frozen / paid / reversed / cancelled", bucketOf(item({ status: "SCHEDULED", releasedAt: null }), NOW) === "scheduled" && bucketOf(item({ status: "FROZEN", releasedAt: null }), NOW) === "frozen" && bucketOf(item({ status: "PAID" }), NOW) === "paid" && bucketOf(item({ status: "REVERSED" }), NOW) === "reversed" && bucketOf(item({ status: "CANCELLED", releasedAt: null }), NOW) === "reversed");
const bal = summarizeBalances([item({ amountCents: 1000 }), item({ amountCents: 500, status: "FROZEN", releasedAt: null }), item({ amountCents: 700, status: "SCHEDULED", releasedAt: null }), item({ amountCents: 300, payoutId: "p" }), item({ amountCents: 200, status: "PAID" }), item({ amountCents: 50, status: "CANCELLED", releasedAt: null })], NOW);
check("summary buckets", bal.available === 1000 && bal.frozen === 500 && bal.scheduled === 700 && bal.requested === 300 && bal.paid === 200 && bal.reversed === 50, JSON.stringify(bal));

// --- reserve
const rs = summarizeReserve([{ type: "RESERVED", amountCents: 200_000 }, { type: "RESERVED", amountCents: 500_000 }, { type: "RELEASED", amountCents: 50_000 }, { type: "RETURNED", amountCents: 10_000 }]);
check("reserve outstanding = reserved - released - returned", rs.reserved === 700_000 && rs.outstanding === 640_000, JSON.stringify(rs));
check("shortfall alert", reserveShortfall(640_000, 700_000) === 0 && reserveShortfall(640_000, 600_000) === 40_000);
check("idempotency keys are deterministic and distinct", ledgerKey.release("c1", 2) === ledgerKey.release("c1", 2) && ledgerKey.release("c1", 2) !== ledgerKey.release("c1", 3) && ledgerKey.commission("p", 0) !== ledgerKey.commission("p", 1));
const worstMonth = 10 * computeContractMoney(idx, NOW).reserveCents;
check("worst month (10 Index) reserve is $180,000", worstMonth === 18_000_000);

// --- slots
check("monthKey", monthKey(new Date("2026-11-30T23:59:59Z")) === "2026-11" && monthKey(new Date("2026-12-01T00:00:00Z")) === "2026-12");
const slot = { limit: 10, opened: true };
const held = (n: number, status: string, exp: Date) => Array.from({ length: n }, () => ({ status, expiresAt: exp }));
check("remaining counts converted + live holds", slotsRemaining(slot, [...held(4, "CONVERTED", past), ...held(3, "HELD", future)], NOW) === 3);
check("expired / released holds free the slot", slotsRemaining(slot, [...held(3, "HELD", past), ...held(2, "RELEASED", future), ...held(1, "EXPIRED", future)], NOW) === 10);
check("never negative; closed month has none", slotsRemaining(slot, held(12, "CONVERTED", past), NOW) === 0 && slotsRemaining({ limit: 10, opened: false }, [], NOW) === 0 && slotsRemaining(null, [], NOW) === 0);
check("hold lasts 30 minutes", holdExpiry(NOW).getTime() - NOW.getTime() === 30 * 60_000);

// --- referral codes and links
const code = generateReferralCode();
check("code is 8 readable characters", code.length === 8 && [...code].every((c) => CODE_ALPHABET.includes(c)) && !/[01OIL]/.test(code), code);
check("codes differ", new Set(Array.from({ length: 200 }, () => generateReferralCode())).size === 200);
check("code never contains look-alike characters", !/[01OIL]/.test(CODE_ALPHABET));
check("normalize accepts a good code in any case / with spaces", normalizeReferralCode(` ${code.toLowerCase()} `) === code);
check("normalize rejects bad input", normalizeReferralCode("short") === null && normalizeReferralCode("ABCDEFG0") === null && normalizeReferralCode("ABCDEFGHJ") === null && normalizeReferralCode(null) === null && normalizeReferralCode("<script>") === null && normalizeReferralCode(12345678) === null);
check("link format", referralLink("K7M2QX9A") === "https://algotraders24.ai/r/K7M2QX9A" && referralLink("K7M2QX9A", "https://x.test/") === "https://x.test/r/K7M2QX9A");
check("cookie lasts 30 days", REF_COOKIE_MAX_AGE_SECONDS === 30 * 86_400 && REF_COOKIE === "at24_ref");
check("landing path is a fixed internal path", REFERRAL_LANDING_PATH.startsWith("/") && !REFERRAL_LANDING_PATH.startsWith("//"));

// --- admin slot limits
check("limits within 10 are fine", validateSlotLimits({ BTC_AI_ALGO: 5, GOLD_AI_ALGO: 3, INDEX_AI_ALGO: 2 }, 10) === null);
check("limits above 10 in total are refused", validateSlotLimits({ BTC_AI_ALGO: 6, GOLD_AI_ALGO: 3, INDEX_AI_ALGO: 2 }, 10) !== null);
check("negative / fractional limits are refused", validateSlotLimits({ BTC_AI_ALGO: -1 }, 10) !== null && validateSlotLimits({ BTC_AI_ALGO: 1.5 }, 10) !== null);
check("month keys", isMonthKey("2026-11") && isMonthKey("2026-01") && !isMonthKey("2026-13") && !isMonthKey("2026-1") && !isMonthKey("26-11") && !isMonthKey(null));

// --- contract lifecycle (daily sweep)
const endLater = new Date("2027-11-01T00:00:00Z"), endPast = new Date("2026-10-01T00:00:00Z");
check("nothing frozen, term running: ACTIVE", contractStatusAfter("ACTIVE", ["RELEASED", "SCHEDULED", "SCHEDULED", "SCHEDULED"], endLater, NOW) === "ACTIVE");
check("a frozen instalment freezes the contract", contractStatusAfter("ACTIVE", ["RELEASED", "FROZEN", "SCHEDULED"], endLater, NOW) === "FROZEN");
check("restored: FROZEN goes back to ACTIVE", contractStatusAfter("FROZEN", ["RELEASED", "RELEASED", "SCHEDULED"], endLater, NOW) === "ACTIVE");
check("term over and everything released: ENDED", contractStatusAfter("ACTIVE", ["RELEASED", "RELEASED", "RELEASED", "RELEASED"], endPast, NOW) === "ENDED");
check("term over but an instalment is still frozen: stays FROZEN, not ended or forfeited", contractStatusAfter("FROZEN", ["RELEASED", "FROZEN"], endPast, NOW) === "FROZEN");
check("revoked / pending-document are not changed by the sweep", contractStatusAfter("REVOKED", ["RELEASED"], endPast, NOW) === "REVOKED" && contractStatusAfter("PENDING_DOCUMENT", ["SCHEDULED"], endLater, NOW) === "PENDING_DOCUMENT");
check("cancelled-only contract after term: ENDED", contractStatusAfter("ACTIVE", ["RELEASED", "CANCELLED"], endPast, NOW) === "ENDED");
check("unreleased cents = scheduled + frozen only", unreleasedCents([{ amountCents: 100, status: "SCHEDULED" }, { amountCents: 50, status: "FROZEN" }, { amountCents: 70, status: "RELEASED" }, { amountCents: 30, status: "CANCELLED" }, { amountCents: 20, status: "PAID" }]) === 150);
check("refunded / reversed purchases are voided", purchaseVoided("REFUNDED") && purchaseVoided("REVERSED") && !purchaseVoided("COMPLETED") && !purchaseVoided("PENDING"));
// the reserve identity the sweep checks: after releasing 1 of 4 and cancelling the rest, outstanding is zero
const full = mB.reserveCents, one = mB.schedule[0].amountCents;
const after = summarizeReserve([{ type: "RESERVED", amountCents: full }, { type: "RELEASED", amountCents: one }, { type: "RETURNED", amountCents: full - one }]);
check("reserve identity: reserved - released - returned = 0 after a full cancel", after.outstanding === 0, JSON.stringify(after));
const mid = summarizeReserve([{ type: "RESERVED", amountCents: full }, { type: "RELEASED", amountCents: one }]);
check("reserve identity: outstanding equals the 3 remaining instalments", mid.outstanding === unreleasedCents(mB.schedule.slice(1).map((s) => ({ amountCents: s.amountCents, status: "SCHEDULED" }))));

// --- member badge (diamond + colour next to the name)
type PK = "BTC_AI_ALGO" | "GOLD_AI_ALGO" | "INDEX_AI_ALGO";
const bd = (productKey: PK, status: "ACTIVE" | "FROZEN" | "ENDED" | "REVOKED" | "PENDING_DOCUMENT") => badgeFor([{ productKey, status }]);
check("each product has its own diamond colour", new Set(Object.values(BADGE_TIERS).map((t) => t.color)).size === 3);
check("active contract shows the badge", bd("GOLD_AI_ALGO", "ACTIVE")?.tier === "GOLD_AI_ALGO" && bd("GOLD_AI_ALGO", "ACTIVE")?.dimmed === false);
check("frozen contract shows the badge dimmed", bd("BTC_AI_ALGO", "FROZEN")?.dimmed === true);
check("ended / revoked / pending shows no badge", bd("BTC_AI_ALGO", "ENDED") === null && bd("BTC_AI_ALGO", "REVOKED") === null && bd("BTC_AI_ALGO", "PENDING_DOCUMENT") === null && badgeFor([]) === null);
check("highest tier wins with several contracts", badgeFor([{ productKey: "BTC_AI_ALGO", status: "ACTIVE" }, { productKey: "INDEX_AI_ALGO", status: "ACTIVE" }, { productKey: "GOLD_AI_ALGO", status: "ACTIVE" }])?.tier === "INDEX_AI_ALGO");
check("an active lower tier beats a frozen higher one", badgeFor([{ productKey: "INDEX_AI_ALGO", status: "FROZEN" }, { productKey: "BTC_AI_ALGO", status: "ACTIVE" }])?.tier === "BTC_AI_ALGO");
check("name + diamond text", displayNameWithBadge("Ravi", bd("INDEX_AI_ALGO", "ACTIVE")) === "Ravi \u{1F48E}" && displayNameWithBadge("Ravi", null) === "Ravi");
check("badge labels carry no return/profit wording", Object.values(BADGE_TIERS).every((t) => BANNED_COPY_WORDS.every((w) => !(t.label + " " + t.description).toLowerCase().includes(w))));


// --- contract PDF (snapshot of the stored figures; brand only)
async function pdfChecks() {
  const input: ContractPdfInput = {
    contractId: "c_test_1", productName: "BTC AI Algo", buyerName: "Ravi Kumar", buyerEmail: "ravi@example.com", buyerUserId: "u1", licenseId: "lic_1",
    listPriceCents: mB.listPriceCents, rebateTotalCents: mB.rebateTotalCents, netPriceCents: mB.netPriceCents, schedule: mB.schedule,
    startsAt: NOW, endsAt: mB.endsAt, termsVersion: "v-test", consentAt: NOW, issuedAt: NOW,
  };
  const bytes = await buildContractPdf(input);
  check("contract PDF is a real PDF", Buffer.from(bytes.slice(0, 5)).toString() === "%PDF-" && bytes.length > 1500, String(bytes.length));
  const text = contractClauses(input).map((c) => c.title + " " + c.body).join("\n");
  check("contract shows price, total rebate, net price and every instalment", text.includes("$4,999.00") && text.includes("$2,000.00") && text.includes("$2,999.00") && (text.match(/Instalment \d: \$500\.00/g) ?? []).length === 4);
  check("contract names only the brand, no company or licence number", text.includes("algotraders24.ai") && !/\bFZE\b|\bFZ\b|licen[cs]e no|trade licen/i.test(text));
  check("contract says freeze, not forfeit, and 12 months", /paused and kept/.test(text) && /12-month licence/.test(text));
  check("contract has no return / guarantee wording", BANNED_COPY_WORDS.filter((w) => w !== "invest").every((w) => !text.toLowerCase().includes(w)), BANNED_COPY_WORDS.filter((w) => text.toLowerCase().includes(w)).join());
  const odd = await buildContractPdf({ ...input, buyerName: "Zoe \u4e2d\u6587 O'Brien" });
  check("a non-Latin name cannot break the PDF", Buffer.from(odd.slice(0, 5)).toString() === "%PDF-");
}

// --- user guide and purchase email
const gt = guideText().toLowerCase();
const bannedHits = BANNED_COPY_WORDS.filter((w) => new RegExp(`\\b${w.replace(/ /g, "\\s+")}`, "i").test(gt));
check("guide has no banned wording", bannedHits.length === 0, bannedHits.join());
check("guide states the real hold period and minimum", gt.includes(`${HOLD_DAYS}-day hold`) && gt.includes("50 usd") && MIN_PAYOUT_CENTS === 5_000);
check("guide covers every topic", ["what-you-bought", "get-started", "your-contract", "rebate", "withdraw", "referral", "badge", "refunds-risk"].every((id) => GUIDE_SECTIONS.some((s) => s.id === id)) && GUIDE_FAQ.length >= 5);
check("install guide covers MT5 and MT4 with the real folders, the allowed URL and the licence inputs", ["install-mt5", "install-mt4", "licence-values", "per-product", "check-working"].every((id) => GUIDE_SECTIONS.some((s) => s.id === id)) && gt.includes("mql5") && gt.includes("mql4") && gt.includes("https://www.algotraders24.ai") && ["inplicensekey", "inplicenseid", "inpapikey", "inpbuyerid", "inpreleaseid", "show / generate my licence key"].every((k) => gt.includes(k)) && gt.includes("algo trading") && gt.includes("autotrading") && gt.includes("demo account"));
check("troubleshooting covers the common failures", ["webrequest", "not licensed", "account limit", "no orders appear", "all history"].every((k) => gt.includes(k)));
check("guide never asks the buyer to share the API key", /never ask you for it/.test(gt) && !/send (us|me) your (api )?key/.test(gt));
check("guide section ids are unique and the quick start has 4 steps", new Set(GUIDE_SECTIONS.map((s) => s.id)).size === GUIDE_SECTIONS.length && QUICK_START.length === 4 && GUIDE_PATH === "/dashboard/algo-contracts/guide");
check("guide says a pause keeps the money and that results are not promised", /paused and kept/.test(gt) && /no promise about trading results/.test(gt) && /sales are final/.test(gt));
const emailIn = { name: "Ravi <b>K</b>", productName: "BTC AI Algo", contractId: "c_1", listPriceCents: mB.listPriceCents, rebateTotalCents: mB.rebateTotalCents, netPriceCents: mB.netPriceCents, schedule: mB.schedule, startsAt: NOW, endsAt: mB.endsAt, siteUrl: "https://algotraders24.ai/", pdfAttached: true };
const eb = contractEmailBody(emailIn);
check("email shows price, total rebate, net price and 4 instalments", eb.includes("$4,999.00") && eb.includes("$2,000.00") && eb.includes("$2,999.00") && (eb.match(/Rebate \d &middot; due/g) ?? []).length === 4);
check("email escapes the buyer name", !eb.includes("<b>K</b>") && eb.includes(escapeHtmlText("Ravi <b>K</b>")));
check("email links the guide (no double slash) and mentions the attached PDF", eb.includes("https://algotraders24.ai/dashboard/algo-contracts/guide") && /attached to this email/.test(eb) && !/attached to this email/.test(contractEmailBody({ ...emailIn, pdfAttached: false })));
check("email subject names the product and the email has no banned wording", contractEmailSubject("BTC AI Algo").includes("BTC AI Algo") && BANNED_COPY_WORDS.every((w) => !new RegExp(`\\b${w.replace(/ /g, "\\s+")}`, "i").test(eb)));

// --- page view-model (what the Algo Contracts page shows is the same maths that issues the contract)
const vmB = buildProductVM("BTC_AI_ALGO", { slot: { opened: true, limit: 5, remaining: 3 }, blockedReason: null });
check("page card for BTC: price, rebate, net, instalments, interval", vmB.listPriceCents === 499_900 && vmB.rebateTotalCents === 200_000 && vmB.netPriceCents === 299_900 && vmB.perQuarterCents === 50_000 && vmB.installments === 4 && vmB.intervalMonths === 3 && vmB.termMonths === 12);
const vmI = buildProductVM("INDEX_AI_ALGO", { slot: null, blockedReason: "Opens soon" });
check("page card for Index and its referral amounts", vmI.netPriceCents === 1_199_900 && vmI.perQuarterCents === 450_000 && vmI.referralDirectCents === 60_000 && vmI.referralUpperCents.join() === "30000,30000,30000" && vmI.blockedReason === "Opens soon");
check("every page card adds up: price - rebate = net, 4 x instalment = rebate", REWARD_PRODUCT_KEYS.every((k) => { const v = buildProductVM(k, { slot: null, blockedReason: null }); return v.listPriceCents - v.rebateTotalCents === v.netPriceCents && v.perQuarterCents * v.installments === v.rebateTotalCents; }));
check("page taglines carry no banned wording", REWARD_PRODUCT_KEYS.every((k) => BANNED_COPY_WORDS.every((w) => !new RegExp(`\\b${w.replace(/ /g, "\\s+")}`, "i").test(buildProductVM(k, { slot: null, blockedReason: null }).tagline))));

// --- copy guard on the strings this program shows
const copy = REWARD_PRODUCT_KEYS.map((k) => REWARD_PRODUCTS[k].name).join(" ").toLowerCase();
check("no banned words in product names", BANNED_COPY_WORDS.every((w) => !copy.includes(w)));

pdfChecks().then(() => {
  console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
});
