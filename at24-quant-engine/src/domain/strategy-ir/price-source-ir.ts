/** Q0.7.25 — no hidden substitutions: an IR node that reads "the price" must say which price. */
export type PriceSourceKind = "OPEN" | "HIGH" | "LOW" | "CLOSE" | "TYPICAL_PRICE" | "MEDIAN_PRICE" | "CUSTOM";

/**
 * Q0.7.26 — critical for cross-platform parity: two platforms both
 * claiming "stop-loss = entry - 5" can still diverge if one measures
 * from the SIGNAL BAR'S close and the other from the actual FILL price
 * (exactly the distinction Q0.5's own Known Limitation #1 documents for
 * AT24's own D1 engine — docs/Q0.5_EXECUTION_MODEL.md). This field makes
 * that distinction explicit and comparable instead of implicit per-engine.
 */
export type SLTPReferenceKind = "SIGNAL_BAR_CLOSE" | "ENTRY_PRICE" | "FILL_PRICE" | "SWING_EXTREME" | "ATR_DERIVED" | "ABSOLUTE_PRICE" | "PERCENTAGE";
