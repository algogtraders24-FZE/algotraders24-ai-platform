// services/live-sync/validate.ts
// AT24 Live Sync (P1) - strict, closed-schema validation of an ingest body.
// Hand-written (repo convention, no schema library). Anything unexpected is
// rejected: unknown fields (incl. any identity field), wrong types, out-of-range
// numbers, oversized arrays. Free text (the deal comment) is sanitized, not trusted.

import {
  ACCOUNT_KEYS, BODY_KEYS, DEAL_KEYS, LIMITS, LIVE_SYNC_VERSION, POSITION_KEYS, SNAPSHOT_KEYS,
  type AccountMode, type DealEntry, type DealType, type IngestBody, type MarginMode, type WireAccountFacts, type WireDeal, type WirePosition, type WireSnapshot,
} from "./contract";

export type ValidationResult = { ok: true; body: IngestBody } | { ok: false; message: string };

const HEX64 = /^[0-9a-f]{64}$/;
const SYMBOL = /^[A-Za-z0-9._#@$-]*$/;
const MIN_MSC = 946_684_800_000; // 2000-01-01
const MAX_MSC = 4_102_444_800_000; // 2100-01-01
const DEAL_TYPES: readonly DealType[] = ["buy", "sell", "balance", "other"];
const DEAL_ENTRIES: readonly DealEntry[] = ["in", "out", "inout", "none"];
const MODES: readonly AccountMode[] = ["demo", "real", "contest"];
const MARGIN_MODES: readonly MarginMode[] = ["hedging", "netting"];

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });

function onlyKeys(o: Rec, allowed: readonly string[], where: string): string | null {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) return `${where}: unknown field "${k.slice(0, 40)}"`;
  return null;
}
const finite = (v: unknown, max = 1e12): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= max;
const int = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const oneOf = <T extends string>(v: unknown, set: readonly T[]): v is T => typeof v === "string" && (set as readonly string[]).includes(v);

/** Strip control characters, collapse whitespace, cap length. */
export function sanitizeComment(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, LIMITS.commentMaxLen);
}

function parseDeal(raw: unknown, i: number): WireDeal | string {
  if (!isRec(raw)) return `deals[${i}] must be an object`;
  const extra = onlyKeys(raw, DEAL_KEYS, `deals[${i}]`);
  if (extra) return extra;
  const { ticket, positionId, timeMsc, symbol, type, entry, volume, price, commission, swap, profit, fee, magic, comment } = raw;
  if (!int(ticket, 1, Number.MAX_SAFE_INTEGER)) return `deals[${i}].ticket invalid`;
  if (!int(positionId, 0, Number.MAX_SAFE_INTEGER)) return `deals[${i}].positionId invalid`;
  if (!int(timeMsc, MIN_MSC, MAX_MSC)) return `deals[${i}].timeMsc invalid`;
  if (typeof symbol !== "string" || symbol.length > LIMITS.symbolMaxLen || !SYMBOL.test(symbol)) return `deals[${i}].symbol invalid`;
  if (!oneOf(type, DEAL_TYPES)) return `deals[${i}].type invalid`;
  if (!oneOf(entry, DEAL_ENTRIES)) return `deals[${i}].entry invalid`;
  if (!finite(volume, 1e6) || volume < 0) return `deals[${i}].volume invalid`;
  if (!finite(price, 1e9) || price < 0) return `deals[${i}].price invalid`;
  if (!finite(commission) || !finite(swap) || !finite(profit) || !finite(fee)) return `deals[${i}] money field invalid`;
  if (!int(magic, 0, Number.MAX_SAFE_INTEGER)) return `deals[${i}].magic invalid`;
  if (typeof comment !== "string" || comment.length > 200) return `deals[${i}].comment invalid`;
  return { ticket, positionId, timeMsc, symbol, type, entry, volume, price, commission, swap, profit, fee, magic, comment: sanitizeComment(comment) };
}

function parsePosition(raw: unknown, i: number): WirePosition | string {
  if (!isRec(raw)) return `positions[${i}] must be an object`;
  const extra = onlyKeys(raw, POSITION_KEYS, `positions[${i}]`);
  if (extra) return extra;
  const { ticket, symbol, side, volume, priceOpen, sl, tp, profit, timeMsc } = raw;
  if (!int(ticket, 1, Number.MAX_SAFE_INTEGER)) return `positions[${i}].ticket invalid`;
  if (typeof symbol !== "string" || symbol.length > LIMITS.symbolMaxLen || symbol.length === 0 || !SYMBOL.test(symbol)) return `positions[${i}].symbol invalid`;
  if (side !== "buy" && side !== "sell") return `positions[${i}].side invalid`;
  if (!finite(volume, 1e6) || volume <= 0) return `positions[${i}].volume invalid`;
  if (!finite(priceOpen, 1e9) || !finite(sl, 1e9) || !finite(tp, 1e9) || !finite(profit)) return `positions[${i}] number invalid`;
  if (!int(timeMsc, MIN_MSC, MAX_MSC)) return `positions[${i}].timeMsc invalid`;
  return { ticket, symbol, side, volume, priceOpen, sl, tp, profit, timeMsc };
}

function parseSnapshot(raw: unknown): WireSnapshot | string {
  if (!isRec(raw)) return "snapshot must be an object";
  const extra = onlyKeys(raw, SNAPSHOT_KEYS, "snapshot");
  if (extra) return extra;
  const { timeMsc, balance, equity, margin, freeMargin, positions } = raw;
  if (!int(timeMsc, MIN_MSC, MAX_MSC)) return "snapshot.timeMsc invalid";
  if (!finite(balance) || !finite(equity) || !finite(margin) || !finite(freeMargin)) return "snapshot money field invalid";
  if (!Array.isArray(positions) || positions.length > LIMITS.maxPositions) return "snapshot.positions invalid";
  const out: WirePosition[] = [];
  for (let i = 0; i < positions.length; i++) {
    const p = parsePosition(positions[i], i);
    if (typeof p === "string") return p;
    out.push(p);
  }
  return { timeMsc, balance, equity, margin, freeMargin, positions: out };
}

/** A company name: letters, digits, spaces and a few punctuation marks. No angle brackets, quotes or control characters. */
const BROKER_RE = /^[\p{L}\p{N}][\p{L}\p{N} .,&()'+/_-]*$/u;

function parseAccount(raw: unknown): WireAccountFacts | string {
  if (!isRec(raw)) return "account must be an object";
  const extra = onlyKeys(raw, ACCOUNT_KEYS, "account");
  if (extra) return extra;
  const { currency, mode, marginMode, leverage, serverUtcOffsetSec, terminalBuild, broker } = raw;
  if (typeof currency !== "string" || !/^[A-Z]{3,5}$/.test(currency)) return "account.currency invalid";
  if (!oneOf(mode, MODES)) return "account.mode invalid";
  if (!oneOf(marginMode, MARGIN_MODES)) return "account.marginMode invalid";
  if (!int(leverage, 0, 100_000)) return "account.leverage invalid";
  if (!int(serverUtcOffsetSec, -50_400, 50_400)) return "account.serverUtcOffsetSec invalid";
  if (!int(terminalBuild, 0, 1_000_000)) return "account.terminalBuild invalid";
  if (broker === undefined) return { currency, mode, marginMode, leverage, serverUtcOffsetSec, terminalBuild };
  const name = typeof broker === "string" ? broker.trim() : "";
  if (name.length < 1 || name.length > 60 || !BROKER_RE.test(name)) return "account.broker invalid";
  return { currency, mode, marginMode, leverage, serverUtcOffsetSec, terminalBuild, broker: name };
}

export function validateIngestBody(raw: unknown): ValidationResult {
  if (!isRec(raw)) return fail("body must be a JSON object");
  const extra = onlyKeys(raw, BODY_KEYS, "body");
  if (extra) return fail(extra);
  if (raw.v !== LIVE_SYNC_VERSION) return fail("unsupported version");
  if (typeof raw.accountKey !== "string" || !HEX64.test(raw.accountKey)) return fail("accountKey must be 64 lowercase hex characters");
  const account = parseAccount(raw.account);
  if (typeof account === "string") return fail(account);
  if (!Array.isArray(raw.deals) || raw.deals.length > LIMITS.maxDealsPerBatch) return fail(`deals must be an array of at most ${LIMITS.maxDealsPerBatch}`);
  const deals: WireDeal[] = [];
  for (let i = 0; i < raw.deals.length; i++) {
    const d = parseDeal(raw.deals[i], i);
    if (typeof d === "string") return fail(d);
    deals.push(d);
  }
  const tickets = new Set(deals.map((d) => d.ticket));
  if (tickets.size !== deals.length) return fail("duplicate deal tickets in one batch");

  const body: IngestBody = { v: 1, accountKey: raw.accountKey, account, deals };
  if (deals.length > 0) {
    if (!int(raw.seq, 1, 2_000_000_000)) return fail("seq must be an integer >= 1 when deals are present");
    if (typeof raw.prevHash !== "string" || !HEX64.test(raw.prevHash)) return fail("prevHash invalid");
    if (typeof raw.hash !== "string" || !HEX64.test(raw.hash)) return fail("hash invalid");
    body.seq = raw.seq;
    body.prevHash = raw.prevHash;
    body.hash = raw.hash;
  } else if (raw.seq !== undefined || raw.prevHash !== undefined || raw.hash !== undefined) {
    return fail("seq/prevHash/hash are only allowed together with deals");
  }
  if (raw.snapshot !== undefined) {
    const s = parseSnapshot(raw.snapshot);
    if (typeof s === "string") return fail(s);
    body.snapshot = s;
  }
  return { ok: true, body };
}
