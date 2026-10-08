// lib/marketplace/reportCheck.ts
// (Pure policy + result shaping - safe to import from the browser and from scripts.)
// Seller self-serve Phase 2: the seller may attach the MT5 Strategy Tester report. A worker on the AT24 VPS recomputes the
// headline numbers from the report's own Deals table (M2 evidence engine) and compares them with the summary printed in the
// same report. What this proves: the file is a readable MT5 report whose numbers agree with each other. What it does NOT
// prove: that the backtest really ran on real market data (a report file can be edited). So the listing says
// "Checked from the seller's report" and never shows the independent VALIDATED badge.
import { extensionOf } from "@/lib/marketplace/selfServe";

export const ALLOWED_REPORT_EXTENSIONS = [".xlsx", ".html", ".htm"];
/** Supabase Storage's per-file ceiling on our plan; bigger reports should be a shorter test period. */
export const MAX_REPORT_BYTES = 50 * 1024 * 1024;
/** A RUNNING job is re-claimable after this long without a result (the worker crashed). */
export const REPORT_LOCK_MINUTES = 20;
export const MAX_REPORT_ATTEMPTS = 3;
export const MIN_TRADES_FOR_SAMPLE = 30;
export const MIN_PERIOD_DAYS = 30;

export type ReportCheckStatus = "QUEUED" | "RUNNING" | "DONE" | "FAILED";

export interface ReportCheckItem {
  label: string;
  computed: number | null;
  reportValue: number | null;
  withinTolerance: boolean | null;
}

export interface ReportCheckResult {
  schema: 1;
  symbol: string | null;
  broker: string | null;
  timeframe: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  initialDeposit: number | null;
  metrics: {
    tradeCount: number | null;
    netProfit: number | null;
    profitFactor: number | null;
    winRate: number | null; // 0..1
    maxDrawdownPercent: number | null; // 0..1 of equity, as computed by M2
    maxDrawdownAbsolute: number | null;
    recoveryFactor: number | null;
    largestWin: number | null;
    largestLoss: number | null;
    avgTrade: number | null;
  };
  crossCheck: ReportCheckItem[];
  /** true when the numbers we recomputed agree with the report's own printed summary */
  consistent: boolean;
  /** short plain-language caveats (small sample, short period, ...) */
  flags: string[];
}

export function isAllowedReportFile(fileName: string): boolean {
  return ALLOWED_REPORT_EXTENSIONS.includes(extensionOf(fileName));
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown, max = 120): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

/**
 * Accepts whatever the worker posted and keeps ONLY the known, typed fields. The listing page renders this publicly, so
 * nothing outside this shape (free text, HTML, extra keys) is ever stored. Returns null when it is not a usable result.
 */
export function sanitizeReportCheckResult(raw: unknown): ReportCheckResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const m = (r.metrics && typeof r.metrics === "object" ? r.metrics : {}) as Record<string, unknown>;
  const checks = Array.isArray(r.crossCheck) ? r.crossCheck : [];
  const crossCheck: ReportCheckItem[] = checks.slice(0, 12).flatMap((c) => {
    if (!c || typeof c !== "object") return [];
    const o = c as Record<string, unknown>;
    const label = str(o.label, 40);
    if (!label) return [];
    return [{ label, computed: num(o.computed), reportValue: num(o.reportValue), withinTolerance: typeof o.withinTolerance === "boolean" ? o.withinTolerance : null }];
  });
  const metrics = {
    tradeCount: num(m.tradeCount),
    netProfit: num(m.netProfit),
    profitFactor: num(m.profitFactor),
    winRate: num(m.winRate),
    maxDrawdownPercent: num(m.maxDrawdownPercent),
    maxDrawdownAbsolute: num(m.maxDrawdownAbsolute),
    recoveryFactor: num(m.recoveryFactor),
    largestWin: num(m.largestWin),
    largestLoss: num(m.largestLoss),
    avgTrade: num(m.avgTrade),
  };
  if (metrics.tradeCount === null || metrics.netProfit === null) return null;
  const compared = crossCheck.filter((c) => c.withinTolerance !== null);
  // Consistent = the two headline figures (profit, trade count) were actually compared AND every comparison agreed.
  const headline = ["netProfit", "tradeCount"].every((k) => compared.some((c) => c.label === k));
  const consistent = headline && compared.every((c) => c.withinTolerance === true);

  const flags: string[] = [];
  if (metrics.tradeCount < MIN_TRADES_FOR_SAMPLE) flags.push(`Only ${metrics.tradeCount} trades - too small a sample to say much.`);
  const start = str(r.periodStart, 40);
  const end = str(r.periodEnd, 40);
  if (start && end) {
    const days = (Date.parse(end) - Date.parse(start)) / 86_400_000;
    if (Number.isFinite(days) && days < MIN_PERIOD_DAYS) flags.push(`The test period is only ${Math.max(0, Math.round(days))} days.`);
  }
  if (!consistent) flags.push("The numbers recomputed from the deals list do not all agree with the report's own summary.");

  return {
    schema: 1,
    symbol: str(r.symbol, 40),
    broker: str(r.broker, 80),
    timeframe: str(r.timeframe, 60),
    periodStart: start,
    periodEnd: end,
    initialDeposit: num(r.initialDeposit),
    metrics,
    crossCheck,
    consistent,
    flags,
  };
}

/** The short label shown on the listing. Never "Validated". */
export function reportCheckLabel(result: ReportCheckResult | null): string {
  if (!result) return "Not checked";
  return result.consistent ? "Checked from the seller's report" : "Seller's report did not reconcile";
}

/** Seller-safe failure reasons the worker may report (anything else is replaced by a generic text). */
export const SAFE_FAILURE_REASONS = [
  "This does not look like an MT5 Strategy Tester report (.xlsx or .html).",
  "The report has no Deals table - export it with the Deals section included.",
  "The report has no closed trades.",
  "The report is too large to read. Use a shorter test period.",
  "The report could not be read in time. Try a shorter test period.",
  "The report could not be read.",
];

export function safeFailureReason(raw: unknown): string {
  return typeof raw === "string" && SAFE_FAILURE_REASONS.includes(raw) ? raw : "The report could not be read.";
}
