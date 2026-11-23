// lib/chart-engine/signals/record-input.ts
// The body the Pro Chart sends to record a signal, validated field by field (the request body is untrusted), and the key that makes one plan on
// one candle the same signal. Pure: no database, so it is unit-tested directly.
import { isSignalTimeframe } from "@/types/signal";
import { Errors } from "@/services/backend/ErrorHandler";

export interface RecordInput {
  symbol: string;
  timeframe: string;
  dir: string;
  entryType: string;
  entry: number;
  stop: number;
  target: number;
  rr: number;
  score: number;
  scoreMax: number;
  confluences: string[];
  source?: string;
  /** Open time (ms) of the last candle on the chart when the plan was generated. */
  signalTime: number;
  lastClose: number;
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** Validates an untrusted client body into a RecordInput (throws a validation error with the first problem). */
export function parseRecordInput(body: unknown): RecordInput {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const bad = (m: string) => { throw Errors.validation(m); };
  const symbol = typeof b.symbol === "string" ? b.symbol.trim().slice(0, 24) : "";
  if (!/^[A-Za-z0-9._#-]{2,24}$/.test(symbol)) bad("Invalid symbol.");
  if (typeof b.timeframe !== "string" || !isSignalTimeframe(b.timeframe)) bad("Invalid timeframe.");
  if (b.dir !== "long" && b.dir !== "short") bad("dir must be long or short.");
  if (b.entryType !== "market" && b.entryType !== "limit") bad("entryType must be market or limit.");
  const { entry, stop, target, rr, lastClose, signalTime } = b;
  if (!fin(entry) || !fin(stop) || !fin(target) || !fin(rr) || !fin(lastClose)) bad("entry, stop, target, rr and lastClose must be positive numbers.");
  if (typeof signalTime !== "number" || !Number.isFinite(signalTime) || signalTime < 1_000_000_000_000 || signalTime > Date.now() + 3_600_000) bad("Invalid signalTime.");
  const long = b.dir === "long";
  if (long ? !((stop as number) < (entry as number) && (entry as number) < (target as number)) : !((target as number) < (entry as number) && (entry as number) < (stop as number))) bad("stop, entry and target are not in a valid order for the direction.");
  if ((rr as number) < 0.5 || (rr as number) > 8) bad("rr is out of range.");
  const score = typeof b.score === "number" && Number.isInteger(b.score) && b.score >= 0 && b.score <= 12 ? b.score : bad("Invalid score.");
  const scoreMax = typeof b.scoreMax === "number" && Number.isInteger(b.scoreMax) && b.scoreMax >= 1 && b.scoreMax <= 12 ? b.scoreMax : bad("Invalid scoreMax.");
  const confluences = Array.isArray(b.confluences) ? (b.confluences as unknown[]).filter((c): c is string => typeof c === "string").slice(0, 8).map((c) => c.slice(0, 80)) : [];
  return {
    symbol,
    timeframe: b.timeframe as string,
    dir: b.dir as string,
    entryType: b.entryType as string,
    entry: entry as number,
    stop: stop as number,
    target: target as number,
    rr: rr as number,
    score: score as number,
    scoreMax: scoreMax as number,
    confluences,
    source: typeof b.source === "string" ? b.source.slice(0, 300) : undefined,
    signalTime: signalTime as number,
    lastClose: lastClose as number,
  };
}

const price = (n: number) => n.toPrecision(8);
export const dedupeKeyOf = (i: RecordInput) => [i.symbol, i.timeframe, i.dir, i.entryType, price(i.entry), price(i.stop), price(i.target), i.signalTime].join("|");

