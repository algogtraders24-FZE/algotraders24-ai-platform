"""Q1.4 Part 1 - quick sanity check that the existing generators actually
run without error on a real Quant Lite spec, before building anything on
top of them."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from spec_engine.schema import validate_spec
from spec_engine.codegen_mql4 import generate_mql4
from spec_engine.codegen_mql5 import generate_mql5
from spec_engine.codegen_pine import generate_pine

MACD_SPEC = {
    "name": "MACD Crossover", "symbol": "XAUUSD", "timeframe": "1h",
    "indicators": [
        {"id": "macd1", "type": "MACD", "fast": 12, "slow": 26, "signal": 9},
        {"id": "atr14", "type": "ATR", "period": 14},
    ],
    "entry_long": [{"left": "macd1.line", "op": "cross_above", "right": "macd1.signal"}],
    "entry_short": [{"left": "macd1.line", "op": "cross_below", "right": "macd1.signal"}],
    "risk": {"sl_mode": "ATR", "sl_atr_mult": 2.0, "tp_mode": "ATR", "tp_atr_mult": 3.0, "atr_id": "atr14"},
}

errors = validate_spec(MACD_SPEC)
print("validate_spec errors:", errors)

mql4 = generate_mql4(MACD_SPEC)
mql5 = generate_mql5(MACD_SPEC)
pine = generate_pine(MACD_SPEC)

print(f"MQL4 length: {len(mql4)} chars")
print(f"MQL5 length: {len(mql5)} chars")
print(f"Pine length: {len(pine)} chars")

for name, code in [("mql4", mql4), ("mql5", mql5), ("pine", pine)]:
    out_path = os.path.join(os.path.dirname(__file__), "..", "output", f"q14_smoketest_macd.{name}")
    with open(out_path, "w") as f:
        f.write(code)
    print(f"Written: {out_path}")
