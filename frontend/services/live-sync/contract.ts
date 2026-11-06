// services/live-sync/contract.ts
// AT24 Live Sync (P1) - the wire contract between the read-only MT5 Expert
// Advisor and the AT24 ingest endpoint. docs/LIVE-SYNC-SPEC.md.
//
// The schema is a CLOSED allow-list: any field not listed here is rejected, so
// identity fields (login, name, server, ...) cannot be smuggled in. The ONE exception is `account.broker` (the
// broker company name), sent only when the user switches on ShareBrokerName in the EA, one plain string <= 60 chars.

export const LIVE_SYNC_VERSION = 1;

export const LIMITS = {
  /** Request body cap (bytes). */
  maxBodyBytes: 200_000,
  maxDealsPerBatch: 500,
  maxPositions: 50,
  maxPendingOrders: 50,
  maxAccountsPerUser: 10,
  maxDevicesPerUser: 5,
  /** Minimum seconds between accepted snapshots per account (extra ones are dropped, not errors). */
  minSnapshotIntervalSec: 30,
  /** Seconds the EA should wait between syncs (returned by the handshake). */
  minIntervalSec: 30,
  /** Per-device request budget. */
  maxRequestsPerMinute: 30,
  symbolMaxLen: 32,
  commentMaxLen: 40,
} as const;

/** 64 zeros: the "previous hash" of the first batch of an account. */
export const ZERO_HASH = "0".repeat(64);

export type DealType = "buy" | "sell" | "balance" | "other";
export type DealEntry = "in" | "out" | "inout" | "none";
export type AccountMode = "demo" | "real" | "contest";
export type MarginMode = "hedging" | "netting";
/** Which terminal sends the data. Absent = MT5 (every v1.x MT5 EA). */
export type Platform = "mt4" | "mt5";

export interface WireDeal {
  ticket: number;
  positionId: number;
  /** Broker SERVER time in epoch milliseconds (as the terminal reports it). */
  timeMsc: number;
  symbol: string;
  type: DealType;
  entry: DealEntry;
  volume: number;
  price: number;
  commission: number;
  swap: number;
  profit: number;
  fee: number;
  magic: number;
  comment: string;
}

export interface WirePosition {
  ticket: number;
  symbol: string;
  side: "buy" | "sell";
  volume: number;
  priceOpen: number;
  sl: number;
  tp: number;
  profit: number;
  timeMsc: number;
  /** Floating result in pips (signed). Optional (EA v1.2+). */
  pips?: number;
  /** Money lost in the ACCOUNT currency if the stop loss is hit (>= 0). Absent when the position has no stop loss. Optional (EA v1.2+). */
  riskToSl?: number;
}

export type PendingOrderType = "buy_limit" | "sell_limit" | "buy_stop" | "sell_stop" | "buy_stop_limit" | "sell_stop_limit";

/** A pending (not yet filled) order. Optional snapshot content (EA v1.2+). */
export interface WirePendingOrder {
  ticket: number;
  symbol: string;
  type: PendingOrderType;
  volume: number;
  price: number;
  sl: number;
  tp: number;
  timeMsc: number;
}

export interface WireSnapshot {
  timeMsc: number;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  positions: WirePosition[];
  /** Pending orders (EA v1.2+); absent from older EAs. */
  orders?: WirePendingOrder[];
}

export interface WireAccountFacts {
  currency: string;
  mode: AccountMode;
  marginMode: MarginMode;
  leverage: number;
  /** Seconds the broker server clock is ahead of UTC (negative if behind). */
  serverUtcOffsetSec: number;
  terminalBuild: number;
  /** Broker company name. Opt-in (EA input ShareBrokerName); absent otherwise. */
  broker?: string;
  /** "mt4" for the MetaTrader 4 EA; absent = "mt5". */
  platform?: Platform;
}

export interface IngestBody {
  v: 1;
  /** SHA-256(login|server|accountSalt), lowercase hex. The server never sees the login. */
  accountKey: string;
  account: WireAccountFacts;
  /** Chain fields: present iff `deals` is non-empty. */
  seq?: number;
  prevHash?: string;
  hash?: string;
  deals: WireDeal[];
  snapshot?: WireSnapshot;
}

export const DEAL_KEYS = ["ticket", "positionId", "timeMsc", "symbol", "type", "entry", "volume", "price", "commission", "swap", "profit", "fee", "magic", "comment"] as const;
export const POSITION_KEYS = ["ticket", "symbol", "side", "volume", "priceOpen", "sl", "tp", "profit", "timeMsc", "pips", "riskToSl"] as const;
export const ORDER_KEYS = ["ticket", "symbol", "type", "volume", "price", "sl", "tp", "timeMsc"] as const;
export const ORDER_TYPES = ["buy_limit", "sell_limit", "buy_stop", "sell_stop", "buy_stop_limit", "sell_stop_limit"] as const;
export const SNAPSHOT_KEYS = ["timeMsc", "balance", "equity", "margin", "freeMargin", "positions", "orders"] as const;
export const ACCOUNT_KEYS = ["currency", "mode", "marginMode", "leverage", "serverUtcOffsetSec", "terminalBuild", "broker", "platform"] as const;
export const BODY_KEYS = ["v", "accountKey", "account", "seq", "prevHash", "hash", "deals", "snapshot"] as const;
