// scripts/validate-seller-earnings.ts
// Seller self-serve Phase 4: the money rules (commission split, hold period, payout limits, address format).
// Pure - no database, no network. Run: npx tsx scripts/validate-seller-earnings.ts
import {
  computeSaleSplit, availableAtFor, summarizeEarnings, earningBucket, payoutBlocker, validatePayoutAddress, gatewayFeePct,
  COMMISSION_RATE, HOLD_DAYS, MIN_PAYOUT_USD, DEFAULT_GATEWAY_FEE_PCT,
} from "../lib/marketplace/earnings";
import { isPlatformOwner } from "../lib/marketplace/selfServe";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
}

// --- the split
const a = computeSaleSplit(100, { gatewayPct: 0.5 });
check("100 USD: 10 commission, 0.50 gateway, 89.50 to the seller", a.commissionAmount === 10 && a.gatewayFee === 0.5 && a.netAmount === 89.5, JSON.stringify(a));
check("split always adds up to the price", a.commissionAmount + a.gatewayFee + a.netAmount === a.grossAmount);
const b = computeSaleSplit(299, { gatewayPct: 0.5 });
check("299 USD rounds to cents and still adds up", Math.abs(b.commissionAmount + b.gatewayFee + b.netAmount - b.grossAmount) < 0.0001, JSON.stringify(b));
const c = computeSaleSplit(0.99, { gatewayPct: 0.5 });
check("tiny sale: never a negative net", c.netAmount >= 0);
check("zero / negative price gives zero", computeSaleSplit(0).netAmount === 0 && computeSaleSplit(-5).grossAmount === 0);
check("default rate is 10%", COMMISSION_RATE === 0.1 && computeSaleSplit(50, { gatewayPct: 0 }).commissionAmount === 5);
check("owner rate 0 (not used for owners, but supported)", computeSaleSplit(100, { commissionRate: 0, gatewayPct: 0 }).netAmount === 100);

// --- gateway fee env
check("gateway fee default", gatewayFeePct("") === DEFAULT_GATEWAY_FEE_PCT && gatewayFeePct(undefined) === DEFAULT_GATEWAY_FEE_PCT);
check("gateway fee override", gatewayFeePct("1.5") === 1.5);
check("gateway fee garbage/out of range falls back", gatewayFeePct("abc") === DEFAULT_GATEWAY_FEE_PCT && gatewayFeePct("-1") === DEFAULT_GATEWAY_FEE_PCT && gatewayFeePct("99") === DEFAULT_GATEWAY_FEE_PCT);

// --- hold + buckets
const sold = new Date("2026-10-01T12:00:00Z");
const avail = availableAtFor(sold);
check(`hold is ${HOLD_DAYS} days`, avail.getTime() - sold.getTime() === HOLD_DAYS * 86_400_000);
const e = { netAmount: 89.5, status: "PENDING", payoutId: null as string | null, availableAt: avail };
check("inside the hold -> holding", earningBucket(e, new Date("2026-10-05T00:00:00Z")) === "holding");
check("after the hold -> available", earningBucket(e, new Date("2026-10-09T00:00:00Z")) === "available");
check("reserved by a payout -> requested", earningBucket({ ...e, payoutId: "p1" }, new Date("2026-10-09T00:00:00Z")) === "requested");
check("paid / reversed buckets", earningBucket({ ...e, status: "PAID", payoutId: "p1" }) === "paid" && earningBucket({ ...e, status: "REVERSED" }) === "reversed");
const sum = summarizeEarnings(
  [e, { ...e, netAmount: 10 }, { ...e, netAmount: 5, payoutId: "p1" }, { ...e, netAmount: 20, status: "PAID", payoutId: "p0" }, { ...e, netAmount: 7, status: "REVERSED" }],
  new Date("2026-10-09T00:00:00Z"),
);
check("summary buckets", sum.available === 99.5 && sum.requested === 5 && sum.paid === 20 && sum.reversed === 7 && sum.holding === 0, JSON.stringify(sum));
check("a refunded sale is never counted as owed", sum.available + sum.holding + sum.requested + sum.paid === 124.5);

// --- payout limits
check(`below ${MIN_PAYOUT_USD} USD is refused`, payoutBlocker(49.99) !== null && payoutBlocker(MIN_PAYOUT_USD) === null);

// --- addresses
const trc = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";
check("valid TRC20", validatePayoutAddress("TRC20", trc) === null);
check("TRC20 rejects an 0x address", validatePayoutAddress("TRC20", "0x" + "a".repeat(40)) !== null);
check("valid ERC20 / BEP20", validatePayoutAddress("ERC20", "0x" + "aB3".repeat(13) + "a") === null && validatePayoutAddress("BEP20", "0x" + "1".repeat(40)) === null);
check("EVM rejects short / non-hex / a TRC20 address", validatePayoutAddress("ERC20", "0x123") !== null && validatePayoutAddress("ERC20", "0x" + "z".repeat(40)) !== null && validatePayoutAddress("ERC20", trc) !== null);
check("unknown network rejected", validatePayoutAddress("BTC", trc) !== null);
check("surrounding spaces tolerated", validatePayoutAddress("TRC20", `  ${trc}  `) === null);

// --- owner products carry no ledger row
check("owner emails are recognised (0% / no ledger)", isPlatformOwner("algogtraders24@gmail.com") && isPlatformOwner("PRAVINAWARI@outlook.com") && !isPlatformOwner("seller@example.com"));

console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
