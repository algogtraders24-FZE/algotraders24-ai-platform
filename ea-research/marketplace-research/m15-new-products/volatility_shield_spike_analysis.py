"""
AT24 Volatility Shield - real spike-detection validation. This is NOT a
directional strategy, so a win-rate/profit-factor backtest is not the
right kind of evidence for it (it has no entries of its own to
evidence). Instead this runs the EXACT spike-detection logic from
AT24_Volatility_Shield.mq5 (ATR(14) M5 vs its own rolling 100-bar
baseline, ratio >= 2.5x triggers) against real historical candles
already in quant_engine/market.db, and reports every real spike it
would have caught - proof the trigger logic fires on genuine
historical volatility events.

Usage: python volatility_shield_spike_analysis.py <SYMBOL>
"""
import sqlite3
import sys
import pandas as pd
import numpy as np

DB_PATH = r"E:\algotraders24-ai-platform\quant_engine\market.db"

FAST_ATR = 14
BASELINE_BARS = 100
SPIKE_MULTIPLE = 2.5
COOLDOWN_BARS = 6  # 6 * M5 = 30 minutes, matches InpCooldownMinutes=30


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
    symbol = sys.argv[1]
    df = load_candles(symbol, "5m")
    df["atr"] = atr(df, FAST_ATR)
    df["baseline"] = df["atr"].rolling(BASELINE_BARS).mean()
    df["ratio"] = df["atr"] / df["baseline"]
    df = df.dropna(subset=["ratio"]).copy()

    rows = df.reset_index().to_dict("records")
    spikes = []
    cooldown_until_idx = -1

    for i, r in enumerate(rows):
        if i < cooldown_until_idx:
            continue
        if r["ratio"] >= SPIKE_MULTIPLE:
            # real single-bar move size, for context on what was actually caught
            bar_range = r["high"] - r["low"]
            spikes.append({"ts": r["ts"], "ratio": r["ratio"], "atr": r["atr"], "baseline": r["baseline"], "bar_range": bar_range})
            cooldown_until_idx = i + COOLDOWN_BARS

    print(f"Symbol: {symbol}  Period: {df.index[0]} to {df.index[-1]}  ({len(df)} M5 bars)")
    print(f"Real volatility spikes detected (ratio >= {SPIKE_MULTIPLE}x, {COOLDOWN_BARS}-bar cooldown between triggers): {len(spikes)}")
    print(f"That is roughly 1 real spike caught every {len(df)/len(spikes)/288:.1f} days on average." if spikes else "No spikes in this period.")
    print()
    print("Sample of real detected spikes (first 15):")
    for s in spikes[:15]:
        print(f"  {s['ts']}  ratio={s['ratio']:.2f}x  ATR={s['atr']:.4f}  baseline={s['baseline']:.4f}  bar_range={s['bar_range']:.4f}")


if __name__ == "__main__":
    main()
