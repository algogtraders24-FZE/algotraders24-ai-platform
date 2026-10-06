// services/edge-analyzer/parsers/mt5-html.ts
// AT24 Trader Edge Analyzer (E1) - MetaTrader 5 "Trade History Report" (HTML).
//
// Built against a REAL terminal export (English, hedging account), not guessed:
//   - the file is UTF-16LE with a BOM;
//   - the Positions table header lists 13 columns but every data row has 14: an
//     unlabelled comment cell sits between "Type" and "Volume";
//   - numbers use a space as thousands separator and "." as decimal;
//   - the report ends with the terminal's own Results block, which we use to
//     reconcile our numbers (see analysis/reconcile.ts).
// Anything that does not match this layout is REJECTED with a clear error rather
// than parsed on a guess - a misaligned column would silently corrupt every number.
//
// Safety: the HTML is never executed or rendered; it is tokenized with bounded,
// linear regexes; size/row caps apply; account number, holder name, company and
// server are never extracted.

import type { BalanceOp, ClosedTrade, Mt5ParseResult, ReportedResults, ReportMeta } from "../types";

export const MAX_REPORT_CHARS = 12_000_000;
export const MAX_REPORT_ROWS = 200_000;
export const MAX_TRADES = 20_000;

/** Decodes an uploaded report buffer: UTF-16LE/BE (BOM) or UTF-8. */
export function decodeReportBuffer(buf: Uint8Array): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.subarray(2));
  const text = new TextDecoder("utf-8").decode(buf);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

const ENTITIES: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

function decodeEntities(s: string): string {
  return s
    .replace(/&(?:nbsp|amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d{1,6});/g, (_, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/ /g, " ");
}

function extractRows(html: string): string[][] {
  const rows: string[][] = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = trRe.exec(html)) !== null) {
    if (rows.length >= MAX_REPORT_ROWS) break;
    const cells: string[] = [];
    const tdRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let c: RegExpExecArray | null;
    while ((c = tdRe.exec(m[1]!)) !== null) {
      cells.push(decodeEntities(c[1]!.replace(/<[^>]*>/g, "")).trim());
    }
    rows.push(cells);
  }
  return rows;
}

/** Strict: "5 000.00" / "-12.00" / "1" only. Anything else (e.g. a comma decimal) is null. */
export function parseMt5Number(raw: string): number | null {
  const t = raw.replace(/\s/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const DATE_RE = /^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/** Naive broker-time timestamp -> epoch ms (components read as UTC). */
export function parseMt5Time(raw: string): number | null {
  const m = DATE_RE.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number) as number[];
  const t = Date.UTC(y!, mo! - 1, d, h, mi, s);
  return Number.isFinite(t) ? t : null;
}

const POSITIONS_HEADER = ["Time", "Position", "Symbol", "Type", "Volume", "Price", "S / L", "T / P", "Time", "Price", "Commission", "Swap", "Profit"];
const DEALS_HEADER_START = ["Time", "Deal", "Symbol", "Type", "Direction", "Volume", "Price", "Order"];
const SECTION_TITLES = new Set(["Positions", "Orders", "Deals", "Open Positions", "Working Orders", "Results"]);

function sameHeader(row: string[], expected: string[]): boolean {
  return expected.every((h, i) => row[i] === h);
}

function parseMeta(rows: string[][]): Omit<ReportMeta, "initialDeposit"> {
  let currency: string | null = null;
  let accountMode: ReportMeta["accountMode"] = null;
  let hedging: boolean | null = null;
  let reportDate: number | null = null;
  for (const r of rows.slice(0, 12)) {
    if (r[0] === "Account:" && r[1]) {
      // "<number> (USD, <server>, demo, Hedge)" - read ONLY currency/mode/margin type.
      const paren = /\(([^)]*)\)/.exec(r[1]);
      const parts = (paren?.[1] ?? "").split(",").map((p) => p.trim().toLowerCase());
      const cur = parts[0] ?? "";
      if (/^[a-z]{3}$/.test(cur)) currency = cur.toUpperCase();
      if (parts.includes("demo")) accountMode = "demo";
      else if (parts.includes("real")) accountMode = "real";
      else if (parts.includes("contest")) accountMode = "contest";
      if (parts.includes("hedge")) hedging = true;
      else if (parts.includes("netting")) hedging = false;
    }
    if (r[0] === "Date:" && r[1]) reportDate = parseMt5Time(r[1] + (r[1].length === 16 ? ":00" : ""));
  }
  return { platform: "MT5", currency, accountMode, hedging, reportDate };
}

function parseReported(rows: string[][]): ReportedResults | null {
  const map = new Map<string, string>();
  let inResults = false;
  for (const r of rows) {
    if (r.length === 1 && r[0] === "Results") inResults = true;
    if (!inResults) continue;
    for (let i = 0; i < r.length - 1; i++) {
      if (r[i]!.endsWith(":") && r[i]!.length > 1) map.set(r[i]!.slice(0, -1), r[i + 1]!);
    }
  }
  if (map.size === 0) return null;
  const num = (k: string): number | null => {
    const v = map.get(k);
    return v === undefined ? null : parseMt5Number(v.replace(/\s*\(.*$/, ""));
  };
  const count = (k: string): number | null => {
    const v = map.get(k);
    const m = v ? /^(\d+)/.exec(v.replace(/\s/g, "")) : null;
    return m ? Number(m[1]) : null;
  };
  const ddMax = map.get("Balance Drawdown Maximal");
  const ddMatch = ddMax ? /^(-?[\d\s.]+?)\s*\(([\d.]+)%\)$/.exec(ddMax) : null;
  return {
    totalNetProfit: num("Total Net Profit"),
    grossProfit: num("Gross Profit"),
    grossLoss: num("Gross Loss"),
    totalTrades: count("Total Trades"),
    shortTrades: count("Short Trades (won %)"),
    longTrades: count("Long Trades (won %)"),
    profitTrades: count("Profit Trades (% of total)"),
    lossTrades: count("Loss Trades (% of total)"),
    balanceDrawdownAbsolute: num("Balance Drawdown Absolute"),
    balanceDrawdownMaximal: ddMatch ? parseMt5Number(ddMatch[1]!) : null,
    balanceDrawdownMaximalPct: ddMatch ? Number(ddMatch[2]) : null,
  };
}

export function parseMt5HtmlReport(text: string): Mt5ParseResult {
  if (text.length > MAX_REPORT_CHARS) return { ok: false, error: "too_large", message: "The report is too large to analyze." };
  if (!/Trade History Report/i.test(text.slice(0, 5000)) || !/<table/i.test(text)) {
    return { ok: false, error: "not_mt5_report", message: "This does not look like a MetaTrader 5 Trade History Report (HTML)." };
  }
  const rows = extractRows(text);
  const warnings: string[] = [];

  const posTitle = rows.findIndex((r) => r.length === 1 && r[0] === "Positions");
  if (posTitle < 0) {
    return { ok: false, error: "unsupported_layout", message: "No Positions section found. Export the History tab as an English MT5 Report (HTML)." };
  }
  const header = rows[posTitle + 1] ?? [];
  if (!sameHeader(header, POSITIONS_HEADER)) {
    return { ok: false, error: "unsupported_layout", message: "The Positions table layout is not recognised (only the English MT5 report is supported)." };
  }

  const trades: ClosedTrade[] = [];
  let skipped = 0;
  for (let i = posTitle + 2; i < rows.length; i++) {
    const r = rows[i]!;
    // A blank spacer row or the next section title ends the Positions table.
    if (r.length <= 1) break;
    // 13 cells = no comment cell; 14 = unlabelled comment cell after "Type".
    if (r.length !== 13 && r.length !== 14) {
      skipped += 1;
      continue;
    }
    const hasTag = r.length === 14;
    const o = hasTag ? 1 : 0;
    const openTime = parseMt5Time(r[0]!);
    // Indices below are for the 13-cell layout; `o` shifts everything after "Type"
    // by one when the unlabelled comment cell is present.
    const closeTime = parseMt5Time(r[8 + o]!);
    const volume = parseMt5Number(r[4 + o]!);
    const openPrice = parseMt5Number(r[5 + o]!);
    const closePrice = parseMt5Number(r[9 + o]!);
    const commission = parseMt5Number(r[10 + o]!);
    const swap = parseMt5Number(r[11 + o]!);
    const pr = parseMt5Number(r[12 + o]!);
    const direction = r[3]!.toLowerCase();
    if (
      openTime === null || closeTime === null || volume === null || openPrice === null || closePrice === null ||
      commission === null || swap === null || pr === null || (direction !== "buy" && direction !== "sell") || volume <= 0 || closeTime < openTime
    ) {
      skipped += 1;
      continue;
    }
    if (trades.length >= MAX_TRADES) {
      warnings.push(`Only the first ${MAX_TRADES} trades were analyzed.`);
      break;
    }
    const sl = parseMt5Number(r[6 + o]!);
    const tp = parseMt5Number(r[7 + o]!);
    trades.push({
      positionId: r[1]!,
      symbol: r[2]!,
      direction,
      volume,
      openTime,
      closeTime,
      openPrice,
      closePrice,
      stopLoss: sl !== null && sl !== 0 ? sl : null,
      takeProfit: tp !== null && tp !== 0 ? tp : null,
      commission,
      swap,
      profit: pr,
      net: Math.round((pr + commission + swap) * 100) / 100,
      tag: hasTag ? r[4]! : "",
    });
  }
  if (skipped > 0) warnings.push(`${skipped} row(s) in the Positions table could not be read and were skipped.`);
  if (trades.length === 0) return { ok: false, error: "no_trades", message: "No closed trades were found in this report." };

  // Balance operations from the Deals section (deposit/withdrawal/adjustment).
  const balanceOps: BalanceOp[] = [];
  const dealsTitle = rows.findIndex((r) => r.length === 1 && r[0] === "Deals");
  if (dealsTitle >= 0 && sameHeader(rows[dealsTitle + 1] ?? [], DEALS_HEADER_START)) {
    for (let i = dealsTitle + 2; i < rows.length; i++) {
      const r = rows[i]!;
      if (r.length === 1 && SECTION_TITLES.has(r[0]!)) break;
      if (r.length === 15 && r[3] === "balance") {
        const t = parseMt5Time(r[0]!);
        const amount = parseMt5Number(r[12]!);
        if (t !== null && amount !== null) balanceOps.push({ time: t, amount });
      }
    }
  }

  const base = parseMeta(rows);
  const first = balanceOps[0];
  const meta: ReportMeta = { ...base, initialDeposit: first && first.amount > 0 ? first.amount : null };
  return { ok: true, meta, trades, balanceOps, reported: parseReported(rows), warnings };
}
