"""
Q1.4 Part 12/16 - the fixed golden strategy set, generated into all 3
languages, with a determinism check (same spec generated twice -> byte-
identical output, per-language) and a scan for accidental BE/trailing/
partial-close code (must never appear, per Part 6/15).
"""
import hashlib
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from spec_engine.schema import validate_spec
from spec_engine.codegen_mql4 import generate_mql4
from spec_engine.codegen_mql5 import generate_mql5
from spec_engine.codegen_pine import generate_pine

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "output", "q14_golden")
os.makedirs(OUT_DIR, exist_ok=True)

GOLDEN = {
    "1_ema_crossover": {
        "name": "Golden EMA Crossover", "symbol": "XAUUSD", "timeframe": "1h",
        "indicators": [{"id": "emaFast", "type": "EMA", "period": 20}, {"id": "emaSlow", "type": "EMA", "period": 50}, {"id": "atr14", "type": "ATR", "period": 14}],
        "entry_long": [{"left": "emaFast", "op": "cross_above", "right": "emaSlow"}],
        "entry_short": [{"left": "emaFast", "op": "cross_below", "right": "emaSlow"}],
        "risk": {"sl_mode": "ATR", "sl_atr_mult": 2.0, "tp_mode": "ATR", "tp_atr_mult": 3.0, "atr_id": "atr14"},
    },
    "2_rsi_oversold": {
        "name": "Golden RSI Oversold", "symbol": "EURUSD", "timeframe": "1h",
        "indicators": [{"id": "rsi14", "type": "RSI", "period": 14}, {"id": "atr14", "type": "ATR", "period": 14}],
        "entry_long": [{"left": "rsi14", "op": "<", "right": 30}],
        "entry_short": [{"left": "rsi14", "op": ">", "right": 70}],
        "risk": {"sl_mode": "ATR", "sl_atr_mult": 1.5, "tp_mode": "ATR", "tp_atr_mult": 2.0, "atr_id": "atr14"},
    },
    "3_macd_cross": {
        "name": "Golden MACD Cross", "symbol": "XAUUSD", "timeframe": "1h",
        "indicators": [{"id": "macd1", "type": "MACD", "fast": 12, "slow": 26, "signal": 9}, {"id": "atr14", "type": "ATR", "period": 14}],
        "entry_long": [{"left": "macd1.line", "op": "cross_above", "right": "macd1.signal"}],
        "entry_short": [{"left": "macd1.line", "op": "cross_below", "right": "macd1.signal"}],
        "risk": {"sl_mode": "ATR", "sl_atr_mult": 2.0, "tp_mode": "ATR", "tp_atr_mult": 3.0, "atr_id": "atr14"},
    },
    "4_bollinger_reversion": {
        "name": "Golden Bollinger Reversion", "symbol": "GBPUSD", "timeframe": "1h",
        "indicators": [{"id": "bb1", "type": "BB", "period": 20, "mult": 2.0}, {"id": "atr14", "type": "ATR", "period": 14}],
        "entry_long": [{"left": "close", "op": "<", "right": "bb1.lower"}],
        "entry_short": [{"left": "close", "op": ">", "right": "bb1.upper"}],
        "risk": {"sl_mode": "ATR", "sl_atr_mult": 1.5, "tp_mode": "ATR", "tp_atr_mult": 2.0, "atr_id": "atr14"},
    },
    "5_multi_indicator": {
        "name": "Golden Multi Indicator", "symbol": "USOIL", "timeframe": "1h",
        "indicators": [
            {"id": "emaTrend", "type": "EMA", "period": 50},
            {"id": "rsiTrig", "type": "RSI", "period": 14},
            {"id": "adxFilt", "type": "ADX", "period": 14},
            {"id": "atr14", "type": "ATR", "period": 14},
        ],
        "entry_long": [
            {"left": "close", "op": ">", "right": "emaTrend"},
            {"left": "rsiTrig", "op": "<", "right": 40},
            {"left": "adxFilt.adx", "op": ">", "right": 20},
        ],
        "entry_short": [
            {"left": "close", "op": "<", "right": "emaTrend"},
            {"left": "rsiTrig", "op": ">", "right": 60},
            {"left": "adxFilt.adx", "op": ">", "right": 20},
        ],
        "risk": {"sl_mode": "ATR", "sl_atr_mult": 2.0, "tp_mode": "ATR", "tp_atr_mult": 3.0, "atr_id": "atr14"},
    },
    "6_atr_pips_sltp": {
        "name": "Golden Fixed Pips SLTP", "symbol": "BTCUSD", "timeframe": "1h",
        "indicators": [{"id": "donch1", "type": "DONCHIAN", "period": 20}],
        "entry_long": [{"left": "close", "op": ">", "right": "donch1.upper"}],
        "entry_short": [{"left": "close", "op": "<", "right": "donch1.lower"}],
        "risk": {"sl_mode": "PIPS", "sl_points": 500.0, "tp_mode": "PIPS", "tp_points": 1000.0},
    },
}

PASS, FAIL = [], []


def check(name, cond, detail=""):
    if cond:
        PASS.append(name)
        print(f"PASS  {name}")
    else:
        FAIL.append(name)
        print(f"FAIL  {name}  {detail}")


FORBIDDEN_KEYWORDS = ["breakeven", "trailing", "trailstop", "partialclose", "partial_close", "movetobreak"]

for key, spec in GOLDEN.items():
    errors = validate_spec(spec)
    check(f"{key}.spec_valid", not errors, errors)
    if errors:
        continue

    for lang, gen, ext in [("mql4", generate_mql4, "mq4"), ("mql5", generate_mql5, "mq5"), ("pine", generate_pine, "pine")]:
        code1 = gen(spec)
        code2 = gen(spec)  # Part 16 determinism - same spec, same generator, twice
        h1 = hashlib.sha256(code1.encode()).hexdigest()
        h2 = hashlib.sha256(code2.encode()).hexdigest()
        check(f"{key}.{lang}.deterministic", h1 == h2, f"{h1} != {h2}")

        lower = code1.lower()
        check(f"{key}.{lang}.no_forbidden_position_management", not any(kw in lower for kw in FORBIDDEN_KEYWORDS))

        out_path = os.path.join(OUT_DIR, f"{key}.{ext}" if lang != "pine" else f"{key}.pine")
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(code1)

print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
sys.exit(1 if FAIL else 0)
