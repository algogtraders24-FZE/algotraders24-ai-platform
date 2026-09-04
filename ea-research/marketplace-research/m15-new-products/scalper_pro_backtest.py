"""
AT24 Quantum Scalper Pro (v1.00) - faithful Python port of the real
AT24_Quantum_Scalper_Pro.mq5 signal engine (M5 Bollinger Band extremes +
RSI(7) exhaustion entries, mean-reversion target at the BB middle band,
ATR-based tight stop, time-based exit), run against real candles already
in quant_engine/market.db.

v2 update: adds the real ADX(14) regime filter now in the .mq5 source
(InpADXMaxForRange=20.0) - mean-reversion entries are skipped when ADX
is above this threshold (a genuinely trending market, where a Bollinger
touch tends to keep extending rather than reverting). This is the fix
for the v1 result (near-breakeven/losing on both EURUSD and GBPUSD
without any regime filter).

Usage: python scalper_pro_backtest.py <SYMBOL> <out_trades.json>
"""
import sqlite3
import sys
import json
import pandas as pd
import numpy as np

DB_PATH = r"E:\algotraders24-ai-platform\quant_engine\market.db"

BB_PERIOD, BB_DEV = 20, 2.0
RSI_PERIOD = 7
RSI_OS, RSI_OB = 25.0, 75.0
ATR_PERIOD = 14
ATR_SL_MULT = 1.2
MAX_HOLD_BARS = 12  # 12 * M5 = 60 minutes, matches InpMaxHoldMinutes=60
ADX_PERIOD = 14
ADX_MAX_FOR_RANGE = 20.0  # matches InpADXMaxForRange


def load_candles(symbol, timeframe):
    con = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query("SELECT ts, open, high, low, close FROM candles WHERE symbol=? AND timeframe=? ORDER BY ts",
                            con, params=(symbol, timeframe))
    con.close()
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    return df.set_index("ts")


def wilder(s, period): return s.ewm(alpha=1.0 / period, adjust=False).mean()


def rsi(close, period):
    delta = close.diff()
    gain, loss = delta.clip(lower=0), -delta.clip(upper=0)
    ag, al = wilder(gain, period), wilder(loss, period)
    rs = ag / al.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(50.0)


def atr(df, period):
    prev_close = df["close"].shift(1)
    tr = pd.concat([df["high"] - df["low"], (df["high"] - prev_close).abs(), (df["low"] - prev_close).abs()], axis=1).max(axis=1)
    return wilder(tr, period)


def bbands(close, period, dev):
    mid = close.rolling(period).mean()
    std = close.rolling(period).std(ddof=0)
    return mid + dev * std, mid, mid - dev * std


def adx(df, period):
    """Wilder's ADX - matches MT5's iADX() convention (Wilder smoothing
    throughout, not a simple/exponential average substitute)."""
    up_move = df["high"].diff()
    down_move = -df["low"].diff()
    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)
    plus_dm = pd.Series(plus_dm, index=df.index)
    minus_dm = pd.Series(minus_dm, index=df.index)

    tr_atr = atr(df, period)  # Wilder-smoothed TR, reused as the ADX denominator base
    plus_di = 100 * wilder(plus_dm, period) / tr_atr.replace(0, np.nan)
    minus_di = 100 * wilder(minus_dm, period) / tr_atr.replace(0, np.nan)
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    return wilder(dx.fillna(0), period)


def main():
    symbol, out_path = sys.argv[1], sys.argv[2]
    df = load_candles(symbol, "5m")
    df["bb_u"], df["bb_m"], df["bb_l"] = bbands(df["close"], BB_PERIOD, BB_DEV)
    df["rsi"] = rsi(df["close"], RSI_PERIOD)
    df["atr"] = atr(df, ATR_PERIOD)
    df["adx"] = adx(df, ADX_PERIOD)
    df = df.dropna(subset=["bb_u", "rsi", "atr", "adx"]).copy()

    rows = df.reset_index().to_dict("records")
    trades = []
    position = None  # {side, entry, sl, entry_idx, entry_time}

    for i in range(1, len(rows)):
        bar, prev = rows[i], rows[i - 1]
        ts = bar["ts"]

        if position is not None:
            hi, lo, close = bar["high"], bar["low"], bar["close"]
            exit_price, exit_reason = None, None
            held_bars = i - position["entry_idx"]

            if position["side"] == "BUY":
                if lo <= position["sl"]:
                    exit_price, exit_reason = position["sl"], "SL"
                elif close >= bar["bb_m"]:
                    exit_price, exit_reason = close, "TARGET"
            else:
                if hi >= position["sl"]:
                    exit_price, exit_reason = position["sl"], "SL"
                elif close <= bar["bb_m"]:
                    exit_price, exit_reason = close, "TARGET"

            if exit_price is None and held_bars >= MAX_HOLD_BARS:
                exit_price, exit_reason = close, "TIME"

            if exit_price is not None:
                pnl = (exit_price - position["entry"]) if position["side"] == "BUY" else (position["entry"] - exit_price)
                trades.append({"entry_time": position["entry_time"].isoformat(), "exit_time": ts.isoformat(),
                               "side": position["side"], "entry": position["entry"], "exit": exit_price,
                               "reason": exit_reason, "pnl_price": pnl})
                position = None

        if position is None and prev["adx"] <= ADX_MAX_FOR_RANGE:
            sl_dist = prev["atr"] * ATR_SL_MULT
            if prev["close"] <= prev["bb_l"] and prev["rsi"] <= RSI_OS:
                entry = bar["open"]
                position = {"side": "BUY", "entry": entry, "sl": entry - sl_dist, "entry_idx": i, "entry_time": ts}
            elif prev["close"] >= prev["bb_u"] and prev["rsi"] >= RSI_OB:
                entry = bar["open"]
                position = {"side": "SELL", "entry": entry, "sl": entry + sl_dist, "entry_idx": i, "entry_time": ts}

    with open(out_path, "w") as f:
        json.dump(trades, f, indent=2)

    print(f"Symbol: {symbol}  Period: {df.index[1]} to {df.index[-1]}")
    print(f"Total trades: {len(trades)}")
    if trades:
        wins = [t for t in trades if t["pnl_price"] > 0]
        gw = sum(t["pnl_price"] for t in trades if t["pnl_price"] > 0)
        gl = -sum(t["pnl_price"] for t in trades if t["pnl_price"] < 0)
        print(f"Win rate: {len(wins)/len(trades)*100:.2f}%  PF: {(gw/gl) if gl else float('inf'):.3f}  Net(price units): {sum(t['pnl_price'] for t in trades):.5f}")
    print(f"Trades written: {out_path}")


if __name__ == "__main__":
    main()
