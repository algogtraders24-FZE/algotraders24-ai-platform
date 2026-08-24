"""
The strategy SPEC — the one structured format every plain-English idea
gets parsed into. Everything downstream (Python backtest interpreter,
MQL5 codegen, Pine Script codegen) reads from this same spec, so the
three outputs never drift apart.

Supported indicators (v1 — enough to cover most simple retail ideas):
  EMA, SMA, RSI, ATR, MACD, BB (Bollinger Bands)

A condition compares two "refs": a ref is "close"/"open"/"high"/"low",
an indicator id (for single-output indicators), or "id.field" for
multi-output indicators (macd.line, macd.signal, macd.hist,
bb.upper/bb.middle/bb.lower), or a plain number constant.

Example spec (this is what "RSI oversold buy with EMA trend filter"
compiles to):

{
  "name": "RSI Oversold + EMA Trend",
  "symbol": "XAUUSD", "timeframe": "1h",
  "indicators": [
    {"id": "rsi14", "type": "RSI", "period": 14},
    {"id": "ema50", "type": "EMA", "period": 50},
    {"id": "atr14", "type": "ATR", "period": 14}
  ],
  "entry_long":  [{"left": "rsi14", "op": "<", "right": 30},
                  {"left": "close", "op": ">", "right": "ema50"}],
  "entry_short": [{"left": "rsi14", "op": ">", "right": 70},
                  {"left": "close", "op": "<", "right": "ema50"}],
  "risk": {"sl_mode": "ATR", "sl_atr_mult": 2.0, "tp_mode": "ATR", "tp_atr_mult": 4.0,
           "atr_id": "atr14"}
}

risk.sl_mode/tp_mode: "ATR" (needs atr_id naming an ATR indicator already in
"indicators") or "PIPS". IMPORTANT: despite the name, sl_points/tp_points
under "PIPS" mode is a raw price-unit distance in the SYMBOL's own price
scale (e.g. 3.0 means $3 for XAUUSD), NOT a broker pip/point count — every
backend (Python runner, MQL5, MQL4, Pine) treats the number identically as
"subtract/add this many price units from the entry price". A real pip
count would need per-symbol digit/point conversion this v1 doesn't do.
"""

VALID_INDICATOR_TYPES = {"EMA", "SMA", "RSI", "ATR", "MACD", "BB",
                          "STOCH", "ADX", "DONCHIAN", "SUPERTREND"}
VALID_OPS = {">", "<", ">=", "<=", "==", "cross_above", "cross_below"}


def validate_spec(spec: dict) -> list:
    """Returns a list of error strings (empty = valid)."""
    errors = []
    if "indicators" not in spec:
        errors.append("missing 'indicators'")
        return errors

    ids = set()
    for ind in spec["indicators"]:
        if ind.get("type") not in VALID_INDICATOR_TYPES:
            errors.append(f"unknown indicator type: {ind.get('type')}")
        if "id" not in ind:
            errors.append(f"indicator missing 'id': {ind}")
        else:
            ids.add(ind["id"])

    for group in ("entry_long", "entry_short"):
        for cond in spec.get(group, []):
            if cond.get("op") not in VALID_OPS:
                errors.append(f"unknown op in {group}: {cond.get('op')}")

    risk = spec.get("risk", {})
    indicator_types_by_id = {ind.get("id"): ind.get("type") for ind in spec.get("indicators", []) if "id" in ind}
    for mode_key in ("sl_mode", "tp_mode"):
        if risk.get(mode_key) != "ATR":
            continue
        atr_id = risk.get("atr_id")
        if not atr_id:
            errors.append(f"risk.{mode_key}=ATR needs risk.atr_id pointing at an ATR indicator")
        elif indicator_types_by_id.get(atr_id) != "ATR":
            errors.append(f"risk.atr_id '{atr_id}' does not refer to an ATR-type indicator in 'indicators'")

    return errors
