/**
 * Canonical event set frozen in Q0.4 (docs/Q0.4_EVENT_MODEL.md), the
 * subset actually implemented in Q0.5. Tick/Quote/Depth/Session events
 * remain reserved (Q0.5.3) — only bar-driven events exist here.
 */
export type SimulationEventType = "MARKET_BAR" | "STRATEGY_CALCULATED" | "ORDER_CREATED" | "ORDER_SUBMITTED" | "ORDER_ACCEPTED" | "ORDER_REJECTED" | "ORDER_TRIGGERED" | "ORDER_PARTIALLY_FILLED" | "ORDER_FILLED" | "ORDER_CANCELLED" | "ORDER_EXPIRED" | "ORDER_MODIFIED" | "ORDER_MODIFICATION_REJECTED" | "ORDER_REPLACED" | "POSITION_OPENED" | "POSITION_MODIFIED" | "POSITION_REDUCED" | "POSITION_CLOSED";
/**
 * Every event's identity is `${eventType}:${timestamp}:${sequence}` —
 * deterministic and reproducible by construction, never a random UUID or
 * a wall-clock-derived value. `sequence` is assigned by the EventQueue at
 * enqueue time (Q0.5.1/Q0.5.2), never by the caller.
 */
export interface SimulationEvent<TPayload = unknown> {
    readonly eventId: string;
    readonly timestamp: number;
    readonly sequence: number;
    readonly eventType: SimulationEventType;
    readonly source: string;
    readonly payload: TPayload;
}
