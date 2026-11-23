// services/exec-bridge/rules.ts
// Pure rules of the Execute bridge: what a valid order request is, how long it lives, what status the user sees, and what the EA may report.
// No database and no HTTP, so every rule is unit-tested directly (scripts/validate-exec-bridge.ts).
import { validateOrder, type OrderRequest } from "@/lib/broker/order-rules";
import { EXEC } from "./config";

export type ExecStatus = "queued" | "sent" | "filled" | "placed" | "refused" | "error" | "expired" | "cancelled";
/** What the user sees: the stored status plus the two time-based states. */
export type ExecViewStatus = ExecStatus | "unknown";

export interface ExecOrderInput {
  order: OrderRequest;
  clientNonce: string;
  expiresAt: Date;
  plan: Record<string, unknown> | null;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const SYMBOL_RE = /^[A-Za-z0-9._#-]{3,24}$/;
const NONCE_RE = /^[A-Za-z0-9_-]{8,64}$/;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Validates an untrusted "place this order" body from the chart. `confirm` must be literally true (the UI sets it only after the user presses Confirm). */
export function parseExecOrderInput(body: unknown, maxLots: number, now: Date): Parsed<ExecOrderInput> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (b.confirm !== true) return { ok: false, message: "The order was not confirmed by the user." };
  const clientNonce = typeof b.clientNonce === "string" ? b.clientNonce : "";
  if (!NONCE_RE.test(clientNonce)) return { ok: false, message: "A client nonce of 8 to 64 letters, digits, _ or - is required." };
  const symbol = typeof b.symbol === "string" ? b.symbol.trim() : "";
  if (!SYMBOL_RE.test(symbol)) return { ok: false, message: "Invalid symbol." };
  const order: OrderRequest = {
    symbol,
    side: b.side as OrderRequest["side"],
    kind: b.kind as OrderRequest["kind"],
    volume: num(b.volume) ?? 0,
    price: num(b.price),
    stopLoss: num(b.stopLoss),
    takeProfit: num(b.takeProfit),
  };
  const problem = validateOrder(order, maxLots);
  if (problem) return { ok: false, message: problem };
  let ttlMs: number;
  if (order.kind === "market") {
    ttlMs = EXEC.marketTtlSec * 1000;
  } else {
    const minutes = num(b.expiresInMinutes) ?? EXEC.limitDefaultMinutes;
    if (!(minutes >= 1) || minutes > EXEC.limitMaxMinutes) return { ok: false, message: `A limit order may live 1 to ${EXEC.limitMaxMinutes} minutes.` };
    ttlMs = Math.round(minutes * 60_000);
  }
  const plan = b.plan && typeof b.plan === "object" && !Array.isArray(b.plan) && JSON.stringify(b.plan).length <= 2000 ? (b.plan as Record<string, unknown>) : null;
  return { ok: true, value: { order, clientNonce, expiresAt: new Date(now.getTime() + ttlMs), plan } };
}

/** The status shown to the user: a queued order past its expiry is expired; a claimed order with no report for a while is unknown. */
export function viewStatus(row: { status: string; expiresAt: Date; claimedAt: Date | null }, now: Date): ExecViewStatus {
  if (row.status === "queued" && row.expiresAt.getTime() <= now.getTime()) return "expired";
  if (row.status === "sent" && row.claimedAt && now.getTime() - row.claimedAt.getTime() > EXEC.unknownAfterSec * 1000) return "unknown";
  return row.status as ExecStatus;
}

export type ReportOutcome = "filled" | "placed" | "refused" | "error";
export interface ExecReport {
  orderId: string;
  outcome: ReportOutcome;
  ticket?: string;
  price?: number;
  retcode?: number;
  reason?: string;
}

/** Validates the EA's result report. The reason is plain text, capped and stripped of control characters. */
export function parseExecReport(body: unknown): Parsed<ExecReport> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const orderId = typeof b.orderId === "string" && /^[A-Za-z0-9_-]{8,40}$/.test(b.orderId) ? b.orderId : "";
  if (!orderId) return { ok: false, message: "Invalid orderId." };
  const outcome = b.outcome;
  if (outcome !== "filled" && outcome !== "placed" && outcome !== "refused" && outcome !== "error") return { ok: false, message: "Invalid outcome." };
  const ticket = typeof b.ticket === "string" || typeof b.ticket === "number" ? String(b.ticket) : undefined;
  if (ticket !== undefined && !/^\d{1,20}$/.test(ticket)) return { ok: false, message: "Invalid ticket." };
  const price = num(b.price);
  if (b.price !== undefined && (price === undefined || price <= 0)) return { ok: false, message: "Invalid price." };
  const retcode = typeof b.retcode === "number" && Number.isInteger(b.retcode) ? b.retcode : undefined;
  const reason = typeof b.reason === "string" ? b.reason.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, EXEC.maxReasonLen) : undefined;
  if ((outcome === "filled" || outcome === "placed") && ticket === undefined) return { ok: false, message: "A filled or placed order needs a ticket." };
  return { ok: true, value: { orderId, outcome, ticket, price, retcode, reason: reason || undefined } };
}
