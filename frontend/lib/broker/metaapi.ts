// lib/broker/metaapi.ts
// Server-side MetaApi (MetaTrader cloud) REST client. Phase 1: ONE account that the owner connected in the MetaApi dashboard, configured with
// env variables (METAAPI_TOKEN, METAAPI_BASE_URL, METAAPI_ACCOUNT_ID); no user credentials ever pass through this app.
// Safety: reading (balance, positions) is always allowed once configured; sending orders needs METAAPI_TRADING_ENABLED=true, and a LIVE
// account additionally needs METAAPI_ALLOW_LIVE=true. Nothing here is called from a loop: every order is one explicit user action.
import "server-only";
import { type OrderRequest, type TradeResult } from "./order-rules";
export { isLiveAccount, maskLogin, tradeSucceeded, validateOrder } from "./order-rules";
export type { OrderKind, OrderRequest, TradeResult } from "./order-rules";

const TIMEOUT_MS = 15_000;

export interface MetaApiConfig {
  token: string;
  baseUrl: string;
  accountId: string;
  tradingEnabled: boolean;
  allowLive: boolean;
  maxLots: number;
  symbolSuffix: string;
}

export function readConfig(): MetaApiConfig | null {
  const token = process.env.METAAPI_TOKEN?.trim();
  const baseUrl = process.env.METAAPI_BASE_URL?.trim().replace(/\/+$/, "");
  const accountId = process.env.METAAPI_ACCOUNT_ID?.trim();
  if (!token || !baseUrl || !accountId) return null;
  const maxLots = Number(process.env.METAAPI_MAX_LOTS ?? 0.1);
  return {
    token,
    baseUrl,
    accountId,
    tradingEnabled: process.env.METAAPI_TRADING_ENABLED === "true",
    allowLive: process.env.METAAPI_ALLOW_LIVE === "true",
    maxLots: Number.isFinite(maxLots) && maxLots > 0 ? maxLots : 0.1,
    symbolSuffix: process.env.METAAPI_SYMBOL_SUFFIX?.trim() ?? "",
  };
}

export class MetaApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

async function call<T>(cfg: MetaApiConfig, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const url = `${cfg.baseUrl}/users/current/accounts/${encodeURIComponent(cfg.accountId)}${path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: init?.method ?? "GET",
      headers: { "auth-token": cfg.token, "Content-Type": "application/json", Accept: "application/json" },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal,
      cache: "no-store",
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
    if (!res.ok) {
      const msg = (json && typeof json === "object" && "message" in json && typeof (json as { message: unknown }).message === "string") ? (json as { message: string }).message : `MetaApi HTTP ${res.status}`;
      throw new MetaApiError(msg, res.status);
    }
    return json as T;
  } catch (e) {
    if (e instanceof MetaApiError) throw e;
    throw new MetaApiError(e instanceof Error && e.name === "AbortError" ? "MetaApi did not answer in time" : "MetaApi is unreachable", 502);
  } finally {
    clearTimeout(timer);
  }
}

export interface AccountInformation {
  broker?: string;
  currency?: string;
  server?: string;
  balance?: number;
  equity?: number;
  margin?: number;
  freeMargin?: number;
  leverage?: number;
  login?: number | string;
  name?: string;
  type?: string;
  tradeAllowed?: boolean;
}

export interface Position {
  id: string;
  type?: string;
  symbol: string;
  volume: number;
  openPrice?: number;
  currentPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  profit?: number;
  time?: string;
}

export interface PendingOrder {
  id: string;
  type?: string;
  symbol: string;
  volume?: number;
  currentVolume?: number;
  openPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  time?: string;
}

export const getAccountInformation = (cfg: MetaApiConfig) => call<AccountInformation>(cfg, "/account-information");
export const getPositions = (cfg: MetaApiConfig) => call<Position[]>(cfg, "/positions");
export const getOrders = (cfg: MetaApiConfig) => call<PendingOrder[]>(cfg, "/orders");

export function placeOrder(cfg: MetaApiConfig, o: OrderRequest): Promise<TradeResult> {
  const actionType = o.kind === "market" ? (o.side === "buy" ? "ORDER_TYPE_BUY" : "ORDER_TYPE_SELL") : (o.side === "buy" ? "ORDER_TYPE_BUY_LIMIT" : "ORDER_TYPE_SELL_LIMIT");
  const body: Record<string, unknown> = { actionType, symbol: o.symbol, volume: o.volume, stopLoss: o.stopLoss, comment: "AT24" };
  if (o.takeProfit !== undefined) body.takeProfit = o.takeProfit;
  if (o.kind === "limit") body.openPrice = o.price;
  return call<TradeResult>(cfg, "/trade", { method: "POST", body });
}

export function closePosition(cfg: MetaApiConfig, positionId: string): Promise<TradeResult> {
  return call<TradeResult>(cfg, "/trade", { method: "POST", body: { actionType: "POSITION_CLOSE_ID", positionId } });
}


/** Maps whatever MetaApi answered to a status this app returns: auth problems on our side of the link are NOT shown as the user's 401/403. */
export function upstreamStatus(e: unknown): 429 | 502 | 504 {
  if (e instanceof MetaApiError) {
    if (e.status === 429) return 429;
    if (e.status === 504 || /did not answer/i.test(e.message)) return 504;
  }
  return 502;
}
