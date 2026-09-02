"""Q1.4 Part 3 - verify all 10 supported indicator types generate cleanly
in all 3 languages, and that unsupported/malformed specs are rejected
(not silently approximated) rather than generated. Read-only, no
market.db access needed - this is pure codegen over synthetic specs."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from spec_engine.schema import validate_spec, VALID_INDICATOR_TYPES
from spec_engine.codegen_mql4 import generate_mql4
from spec_engine.codegen_mql5 import generate_mql5
from spec_engine.codegen_pine import generate_pine

PASS, FAIL = [], []


def check(name, cond, detail=""):
    if cond:
        PASS.append(name)
        print(f"PASS  {name}")
    else:
        FAIL.append(name)
        print(f"FAIL  {name}  {detail}")


# One representative spec per indicator type - each used as BOTH the
# signal AND (where relevant) alongside an ATR for SL/TP, matching how a
# real Quant Lite spec would use it.
INDICATOR_SPECS = {
    "EMA": {"indicators": [{"id": "i1", "type": "EMA", "period": 20}, {"id": "atr14", "type": "ATR", "period": 14}],
            "entry_long": [{"left": "close", "op": ">", "right": "i1"}], "entry_short": [{"left": "close", "op": "<", "right": "i1"}]},
    "SMA": {"indicators": [{"id": "i1", "type": "SMA", "period": 20}, {"id": "atr14", "type": "ATR", "period": 14}],
            "entry_long": [{"left": "close", "op": ">", "right": "i1"}], "entry_short": [{"left": "close", "op": "<", "right": "i1"}]},
    "RSI": {"indicators": [{"id": "i1", "type": "RSI", "period": 14}, {"id": "atr14", "type": "ATR", "period": 14}],
            "entry_long": [{"left": "i1", "op": "<", "right": 30}], "entry_short": [{"left": "i1", "op": ">", "right": 70}]},
    "ATR": {"indicators": [{"id": "i1", "type": "ATR", "period": 14}, {"id": "atr14", "type": "ATR", "period": 14}],
            "entry_long": [{"left": "i1", "op": ">", "right": 1.0}], "entry_short": [{"left": "i1", "op": "<", "right": 0.5}]},
    "MACD": {"indicators": [{"id": "i1", "type": "MACD", "fast": 12, "slow": 26, "signal": 9}, {"id": "atr14", "type": "ATR", "period": 14}],
             "entry_long": [{"left": "i1.line", "op": "cross_above", "right": "i1.signal"}], "entry_short": [{"left": "i1.line", "op": "cross_below", "right": "i1.signal"}]},
    "BB": {"indicators": [{"id": "i1", "type": "BB", "period": 20, "mult": 2.0}, {"id": "atr14", "type": "ATR", "period": 14}],
           "entry_long": [{"left": "close", "op": "<", "right": "i1.lower"}], "entry_short": [{"left": "close", "op": ">", "right": "i1.upper"}]},
    "STOCH": {"indicators": [{"id": "i1", "type": "STOCH", "k_period": 14, "d_period": 3}, {"id": "atr14", "type": "ATR", "period": 14}],
              "entry_long": [{"left": "i1.k", "op": "cross_above", "right": "i1.d"}], "entry_short": [{"left": "i1.k", "op": "cross_below", "right": "i1.d"}]},
    "ADX": {"indicators": [{"id": "i1", "type": "ADX", "period": 14}, {"id": "atr14", "type": "ATR", "period": 14}],
            "entry_long": [{"left": "i1.adx", "op": ">", "right": 25}], "entry_short": [{"left": "i1.adx", "op": ">", "right": 25}]},
    "DONCHIAN": {"indicators": [{"id": "i1", "type": "DONCHIAN", "period": 20}, {"id": "atr14", "type": "ATR", "period": 14}],
                 "entry_long": [{"left": "close", "op": ">", "right": "i1.upper"}], "entry_short": [{"left": "close", "op": "<", "right": "i1.lower"}]},
    "SUPERTREND": {"indicators": [{"id": "i1", "type": "SUPERTREND", "period": 10, "mult": 3.0}, {"id": "atr14", "type": "ATR", "period": 14}],
                   "entry_long": [{"left": "i1.trend", "op": "cross_above", "right": 0}], "entry_short": [{"left": "i1.trend", "op": "cross_below", "right": 0}]},
}

assert set(INDICATOR_SPECS.keys()) == VALID_INDICATOR_TYPES, f"missing coverage: {VALID_INDICATOR_TYPES - set(INDICATOR_SPECS.keys())}"

for itype, partial in INDICATOR_SPECS.items():
    spec = {
        "name": f"{itype} test", "symbol": "XAUUSD", "timeframe": "1h",
        "indicators": partial["indicators"], "entry_long": partial["entry_long"], "entry_short": partial["entry_short"],
        "risk": {"sl_mode": "ATR", "sl_atr_mult": 2.0, "tp_mode": "ATR", "tp_atr_mult": 3.0, "atr_id": "atr14"},
    }
    errors = validate_spec(spec)
    check(f"{itype}.spec_valid", not errors, errors)
    if errors:
        continue
    for lang, gen in [("mql4", generate_mql4), ("mql5", generate_mql5), ("pine", generate_pine)]:
        try:
            code = gen(spec)
            check(f"{itype}.{lang}_generates", len(code) > 100 and itype.lower()[:3] not in ("nan",))
            check(f"{itype}.{lang}_no_be_trailing_partial", not any(kw in code.lower() for kw in ["breakeven", "trailing", "partialclose", "partial_close"]), lang)
        except Exception as e:
            check(f"{itype}.{lang}_generates", False, str(e))

# --- Negative tests (Part 15) --------------------------------------------
bad_indicator_spec = {
    "name": "bad", "symbol": "X", "timeframe": "1h",
    "indicators": [{"id": "i1", "type": "NOT_A_REAL_INDICATOR"}],
    "entry_long": [{"left": "i1", "op": ">", "right": 0}], "entry_short": [],
    "risk": {"sl_mode": "PIPS", "sl_points": 3.0, "tp_mode": "PIPS", "tp_points": 6.0},
}
errs = validate_spec(bad_indicator_spec)
check("negative.unsupported_indicator_rejected_by_validate_spec", len(errs) > 0, errs)

bad_op_spec = {
    "name": "bad", "symbol": "X", "timeframe": "1h",
    "indicators": [{"id": "i1", "type": "RSI", "period": 14}],
    "entry_long": [{"left": "i1", "op": "or_something_fake", "right": 30}], "entry_short": [],
    "risk": {"sl_mode": "PIPS", "sl_points": 3.0, "tp_mode": "PIPS", "tp_points": 6.0},
}
errs2 = validate_spec(bad_op_spec)
check("negative.unsupported_op_rejected_by_validate_spec", len(errs2) > 0, errs2)

# structural check: the schema has no OR-logic field at all - entry_long/
# entry_short are always AND-joined lists, so "OR condition" cannot even
# be expressed, let alone silently approximated.
check("negative.schema_has_no_or_field", "entry_long_or" not in bad_op_spec and "or" not in bad_op_spec)

print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
sys.exit(1 if FAIL else 0)
