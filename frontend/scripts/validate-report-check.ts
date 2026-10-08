// scripts/validate-report-check.ts
// Seller self-serve Phase 2: the policy that decides what a seller's backtest report may claim on a listing.
// Pure - no database, no network. Run: npx tsx scripts/validate-report-check.ts
import { sanitizeReportCheckResult, reportCheckLabel, safeFailureReason, isAllowedReportFile, SAFE_FAILURE_REASONS } from "../lib/marketplace/reportCheck";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
}

const good = {
  symbol: "BTCUSD",
  broker: "Exness Technologies Ltd",
  timeframe: "M15 (2026.06.01 - 2026.08.08)",
  periodStart: "2026-06-01T00:19:01",
  periodEnd: "2026-08-07T23:49:54",
  initialDeposit: 10000,
  metrics: { tradeCount: 6291, netProfit: 187603.5, profitFactor: 1.7379, winRate: 0.6179, maxDrawdownPercent: 0.1834, maxDrawdownAbsolute: 5398.5, recoveryFactor: 34.75, largestWin: 1013, largestLoss: -418.7, avgTrade: 29.82 },
  crossCheck: [
    { label: "netProfit", computed: 187603.5, reportValue: 187603.5, withinTolerance: true },
    { label: "tradeCount", computed: 6291, reportValue: 6291, withinTolerance: true },
    { label: "profitFactor", computed: 1.7379, reportValue: 1.737931, withinTolerance: true },
    { label: "largestWin", computed: 1013, reportValue: null, withinTolerance: null },
  ],
};

const a = sanitizeReportCheckResult(good);
check("a consistent report is accepted", !!a && a.consistent === true);
check("label for a consistent report", reportCheckLabel(a) === "Checked from the seller's report");
check("label is never 'Validated'", !/valid/i.test(reportCheckLabel(a)) && !/valid/i.test(reportCheckLabel(null)));
check("no listing without a check says Not checked", reportCheckLabel(null) === "Not checked");

const mismatch = sanitizeReportCheckResult({ ...good, crossCheck: [{ label: "netProfit", computed: 100, reportValue: 5000, withinTolerance: false }, { label: "tradeCount", computed: 6291, reportValue: 6291, withinTolerance: true }] });
check("a mismatch makes the report 'did not reconcile'", !!mismatch && mismatch.consistent === false && reportCheckLabel(mismatch) === "Seller's report did not reconcile");
check("a mismatch adds a visible flag", !!mismatch && mismatch.flags.some((f) => /do not all agree/.test(f)));

const noHeadline = sanitizeReportCheckResult({ ...good, crossCheck: [{ label: "profitFactor", computed: 1.7, reportValue: 1.7, withinTolerance: true }] });
check("nothing compared on profit + trade count -> not consistent", !!noHeadline && noHeadline.consistent === false);

const small = sanitizeReportCheckResult({ ...good, metrics: { ...good.metrics, tradeCount: 12 }, crossCheck: [{ label: "netProfit", computed: 1, reportValue: 1, withinTolerance: true }, { label: "tradeCount", computed: 12, reportValue: 12, withinTolerance: true }] });
check("small sample is flagged", !!small && small.flags.some((f) => /Only 12 trades/.test(f)));
const short = sanitizeReportCheckResult({ ...good, periodStart: "2026-08-01T00:00:00", periodEnd: "2026-08-10T00:00:00" });
check("short period is flagged", !!short && short.flags.some((f) => /only 9 days/.test(f)));

check("garbage input is rejected", sanitizeReportCheckResult(null) === null && sanitizeReportCheckResult("x") === null && sanitizeReportCheckResult({}) === null);
check("a result without profit/trade count is rejected", sanitizeReportCheckResult({ metrics: { tradeCount: 5 } }) === null);

const dirty = sanitizeReportCheckResult({ ...good, symbol: "<script>alert(1)</script>".repeat(20), extra: "ignored", metrics: { ...good.metrics, netProfit: 1, hacked: "x" } }) as unknown as Record<string, unknown>;
check("unknown keys are dropped", !!dirty && !("extra" in dirty) && !("hacked" in (dirty.metrics as object)));
check("free text is length-capped", typeof dirty.symbol === "string" && (dirty.symbol as string).length <= 40);
check("non-finite numbers become null", sanitizeReportCheckResult({ ...good, metrics: { ...good.metrics, profitFactor: Infinity } })?.metrics.profitFactor === null);

check("failure reasons: known text passes through", safeFailureReason(SAFE_FAILURE_REASONS[1]) === SAFE_FAILURE_REASONS[1]);
check("failure reasons: arbitrary text is replaced", safeFailureReason("Traceback (most recent call last): C:\\secret\\path") === "The report could not be read.");

check("report extensions", isAllowedReportFile("R.xlsx") && isAllowedReportFile("R.HTML") && isAllowedReportFile("r.htm") && !isAllowedReportFile("r.exe") && !isAllowedReportFile("r.zip") && !isAllowedReportFile("r"));

console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
