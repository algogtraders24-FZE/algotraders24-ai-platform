// lib/broker/order-rules.ts
// Pure, network-free rules for the MetaApi integration (kept out of metaapi.ts so they can be unit-tested without the server-only guard).

export interface AccountTypeInfo { type?: string }

export function isLiveAccount(info: AccountTypeInfo): boolean {
  // Unknown is treated as live: an order is only allowed on an account that positively says it is a demo.
  return !(typeof info.type === "string" && info.type.toUpperCase().includes("DEMO"));
}

export type OrderKind = "market" | "limit";
export interface OrderRequest {
  symbol: string;
  side: "buy" | "sell";
  kind: OrderKind;
  volume: number;
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
}

/** Pure validation, so it is unit-testable without any network. Returns an error message or null. */
export function validateOrder(o: OrderRequest, maxLots: number): string | null {
  if (!/^[A-Za-z0-9._#-]{3,24}$/.test(o.symbol)) return "Invalid symbol.";
  if (o.side !== "buy" && o.side !== "sell") return "Side must be buy or sell.";
  if (o.kind !== "market" && o.kind !== "limit") return "Order type must be market or limit.";
  if (!(o.volume >= 0.01) || o.volume > maxLots) return `Volume must be between 0.01 and ${maxLots} lots.`;
  if (Math.round(o.volume * 100) / 100 !== o.volume) return "Volume must have at most 2 decimals.";
  const pos = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n > 0;
  if (o.kind === "limit" && !pos(o.price)) return "A limit order needs a price.";
  if (o.stopLoss !== undefined && !pos(o.stopLoss)) return "Invalid stop loss.";
  if (o.takeProfit !== undefined && !pos(o.takeProfit)) return "Invalid take profit.";
  if (o.stopLoss === undefined) return "A stop loss is required.";
  const ref = o.kind === "limit" ? (o.price as number) : undefined;
  if (ref !== undefined) {
    if (o.side === "buy" && (o.stopLoss >= ref || (o.takeProfit !== undefined && o.takeProfit <= ref))) return "For a buy, stop loss must be below and take profit above the entry price.";
    if (o.side === "sell" && (o.stopLoss <= ref || (o.takeProfit !== undefined && o.takeProfit >= ref))) return "For a sell, stop loss must be above and take profit below the entry price.";
  } else if (o.takeProfit !== undefined) {
    if (o.side === "buy" && o.takeProfit <= o.stopLoss) return "Take profit must be above the stop loss for a buy.";
    if (o.side === "sell" && o.takeProfit >= o.stopLoss) return "Take profit must be below the stop loss for a sell.";
  }
  return null;
}

export interface TradeResult {
  numericCode?: number;
  stringCode?: string;
  message?: string;
  orderId?: string;
  positionId?: string;
}

/** MetaApi answers 200 with a retcode; 10008 (placed) and 10009 (done) are the successes. */
export function tradeSucceeded(r: TradeResult): boolean {
  return r.numericCode === 10009 || r.numericCode === 10008 || r.stringCode === "TRADE_RETCODE_DONE" || r.stringCode === "TRADE_RETCODE_PLACED";
}

export function maskLogin(login: number | string | undefined): string {
  const s = String(login ?? "");
  return s.length <= 4 ? "••••" : `••••${s.slice(-3)}`;
}
