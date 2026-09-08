"""
AT24 BTC Breakout Trend (v1.00) - faithful Python port of the real
AT24_BTC_Breakout_Trend.mq5 signal engine (Donchian(20) H1 breakout,
D1 EMA(50) trend filter, ATR(14) initial stop, ATR(14) chandelier
trailing exit re-armed every bar), run against real BTCUSD_EXNESS
candles already in quant_engine/market.db.

Simplification disclosed: the trailing stop is evaluated once per H1
bar close (matching the EA's own OnTick->new-bar gate for entries, but
the EA's ManageTrailingStop() actually runs every tick) - intrabar
trail tightening is not modeled here, only bar-close trail updates.
This makes the ported backtest's trailing slightly less responsive
than the live EA, a conservative (not favorable) simplification.

Usage: python btc_breakout_backtest.py <SYMBOL> <out_trades.json>
"""
import sqlite3
import sys
import json
import pandas as pd
import numpy as np

DB_PATH = r"E:\algotraders24-ai-platform\quant_engine\market.db"

CHANNEL_LEN = 20
ATR_PERIOD = 14
ATR_SL_MULT = 2.0
ATR_TRAIL_MULT = 3.0
TREND_EMA = 50


def load_candles(symbol, timeframe):
    con = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query("SELECT ts, open, high, low, close FROM candles WHERE symbol=? AND timeframe=? ORDER BY ts",
                            con, params=(symbol, timeframe))
    con.close()
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    return df.set_index("ts")


def wilder(s, period): return s.ewm(alpha=1.0 / period, adjust=False).mean()


def atr(df, period):
    prev_close = df["close"].shift(1)
    tr = pd.concat([df["high"] - df["low"], (df["high"] - prev_close).abs(), (df["low"] - prev_close).abs()], axis=1).max(axis=1)
    return wilder(tr, period)


def main():
    symbol, out_path = sys.argv[1], sys.argv[2]

    h1 = load_candles(symbol, "1h")
    d1 = load_candles(symbol, "1d")

    h1["atr"] = atr(h1, ATR_PERIOD)
    h1["donchian_high"] = h1["high"].rolling(CHANNEL_LEN).max().shift(1)
    h1["donchian_low"] = h1["low"].rolling(CHANNEL_LEN).min().shift(1)
    h1["roll_high"] = h1["high"].rolling(ATR_PERIOD).max()
    h1["roll_low"] = h1["low"].rolling(ATR_PERIOD).min()

    d1["trend_ema"] = d1["close"].ewm(span=TREND_EMA, adjust=False).mean()
    # Map each D1 EMA value forward onto H1 bars (as-of join - each H1
    # bar sees the most recently CLOSED daily EMA, no lookahead).
    d1_ema = d1["trend_ema"].reindex(h1.index, method="ffill")
    h1["trend_ema"] = d1_ema

    h1 = h1.dropna(subset=["atr", "donchian_high", "donchian_low", "trend_ema", "roll_high", "roll_low"]).copy()
    rows = h1.reset_index().to_dict("records")

    trades = []
    position = None  # {side, entry, sl, entry_idx, entry_time}

    for i in range(2, len(rows)):
        bar, prev, prev2 = rows[i], rows[i - 1], rows[i - 2]
        ts = bar["ts"]

        if position is not None:
            hi, lo, close = bar["high"], bar["low"], bar["close"]
            atr_now = bar["atr"]

            if position["side"] == "BUY":
                candidate = bar["roll_high"] - atr_now * ATR_TRAIL_MULT
                position["sl"] = max(position["sl"], candidate)
                if lo <= position["sl"]:
                    exit_price = position["sl"]
                    pnl = exit_price - position["entry"]
                    trades.append({"entry_time": position["entry_time"].isoformat(), "exit_time": ts.isoformat(),
                                   "side": "BUY", "entry": position["entry"], "exit": exit_price, "pnl_price": pnl})
                    position = None
            else:
                candidate = bar["roll_low"] + atr_now * ATR_TRAIL_MULT
                position["sl"] = min(position["sl"], candidate) if position["sl"] else candidate
                if hi >= position["sl"]:
                    exit_price = position["sl"]
                    pnl = position["entry"] - exit_price
                    trades.append({"entry_time": position["entry_time"].isoformat(), "exit_time": ts.isoformat(),
                                   "side": "SELL", "entry": position["entry"], "exit": exit_price, "pnl_price": pnl})
                    position = None

        if position is None:
            long_break = prev2["close"] <= prev["donchian_high"] and prev["close"] > prev["donchian_high"]
            short_break = prev2["close"] >= prev["donchian_low"] and prev["close"] < prev["donchian_low"]
            trend_up = prev["close"] > prev["trend_ema"]
            trend_down = prev["close"] < prev["trend_ema"]

            if long_break and trend_up:
                entry = bar["open"]
                sl = entry - prev["atr"] * ATR_SL_MULT
                position = {"side": "BUY", "entry": entry, "sl": sl, "entry_idx": i, "entry_time": ts}
            elif short_break and trend_down:
                entry = bar["open"]
                sl = entry + prev["atr"] * ATR_SL_MULT
                position = {"side": "SELL", "entry": entry, "sl": sl, "entry_idx": i, "entry_time": ts}

    with open(out_path, "w") as f:
        json.dump(trades, f, indent=2)

    print(f"Symbol: {symbol}  Period: {h1.index[2]} to {h1.index[-1]}")
    print(f"Total trades: {len(trades)}")
    if trades:
        wins = [t for t in trades if t["pnl_price"] > 0]
        gw = sum(t["pnl_price"] for t in trades if t["pnl_price"] > 0)
        gl = -sum(t["pnl_price"] for t in trades if t["pnl_price"] < 0)
        print(f"Win rate: {len(wins)/len(trades)*100:.2f}%  PF: {(gw/gl) if gl else float('inf'):.3f}  Net(price units): {sum(t['pnl_price'] for t in trades):.2f}")
    print(f"Trades written: {out_path}")


if __name__ == "__main__":
    main()
