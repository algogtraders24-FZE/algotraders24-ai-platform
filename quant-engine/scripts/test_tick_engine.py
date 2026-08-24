import os
import sys
import time

import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "quant_engine"))

from engine import RiskConfig
from data_import import load_candles
from spec_engine.execution_tick import run_spec_backtest_tick

SPECS = [
    {
        "name": "MACD Crossover",
        "symbol": "XAUUSD", "timeframe": "1h",
        "indicators": [
            {"id": "macd1", "type": "MACD", "fast": 12, "slow": 26, "signal": 9},
            {"id": "atr14", "type": "ATR", "period": 14},
        ],
        "entry_long": [{"left": "macd1.line", "op": "cross_above", "right": "macd1.signal"}],
        "entry_short": [{"left": "macd1.line", "op": "cross_below", "right": "macd1.signal"}],
        "risk": {"sl_mode": "ATR", "sl_atr_mult": 2.0, "tp_mode": "ATR", "tp_atr_mult": 3.0, "atr_id": "atr14"},
    },
    {
        "name": "Bollinger Mean Reversion",
        "symbol": "XAUUSD", "timeframe": "1h",
        "indicators": [
            {"id": "bb1", "type": "BB", "period": 20, "mult": 2.0},
            {"id": "atr14", "type": "ATR", "period": 14},
        ],
        "entry_long": [{"left": "close", "op": "<", "right": "bb1.lower"}],
        "entry_short": [{"left": "close", "op": ">", "right": "bb1.upper"}],
        "risk": {"sl_mode": "ATR", "sl_atr_mult": 1.5, "tp_mode": "ATR", "tp_atr_mult": 2.0, "atr_id": "atr14"},
    },
]

df_1h = load_candles("XAUUSD", "1h")
df_1h["ts"] = pd.to_datetime(df_1h["ts"], utc=True)
df_2024 = df_1h[(df_1h["ts"] >= "2024-01-01") & (df_1h["ts"] < "2025-01-01")].reset_index(drop=True)
print(f"signal bars in 2024 window: {len(df_2024)}")

risk = RiskConfig(risk_pct=1.0, spread_price=0.30, contract_size=100, start_balance=10000)

for spec in SPECS:
    t0 = time.time()
    trades_df, equity, stats = run_spec_backtest_tick(
        df_2024, spec, risk, zip_symbol="XAUUSD", csv_symbol="XAUUSD", years=["2024"],
    )
    print(f"\n=== {spec['name']} === elapsed: {time.time()-t0:.0f}s")
    print(stats)
    if stats.get("account_blown"):
        print("account_blown=True -> checking no trade continued after balance<=0:")
        trades_df["cum_balance"] = 10000 + trades_df["pnl"].cumsum()
        print("min cum_balance:", trades_df["cum_balance"].min())
        print("last 5 trades:")
        print(trades_df.tail(5).to_string())
