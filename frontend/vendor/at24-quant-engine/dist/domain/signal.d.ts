import type { Instrument, Timeframe } from "./market-data.js";
export type SignalDirection = "BUY" | "SELL" | "FLAT";
export interface Signal {
    readonly direction: SignalDirection;
    readonly instrument: Instrument;
    readonly timeframe: Timeframe;
    readonly generatedAt: number;
    readonly strategyId: string;
    readonly strategyVersion: string;
    readonly triggeredByRuleId: string | null;
}
