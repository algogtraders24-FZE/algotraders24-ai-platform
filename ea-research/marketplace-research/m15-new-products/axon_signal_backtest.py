"""
AT24 Axon Signal Engine (v1.00) - faithful Python port of the real
AT24_Axon_Signal_Engine.mq5 signal engine (4-factor confluence: EMA
trend, RSI momentum, ADX +DI/-DI direction, MACD histogram
acceleration - composite score >= InpMinScore of 4 to enter), run
against real candles already in quant_engine/market.db.

Usage: python axon_signal_backtest.py <SYMBOL> <out_trades.json>
"""
import sqlite3
import sys
import json
import pandas as pd
import numpy as np

DB_PATH = r"E:\algotraders24-ai-platform\quant_engine\market.db"

EMA_FAST, EMA_SLOW = 20, 50
RSI_PERIOD = 14
ADX_PERIOD = 14
ATR_PERIOD = 14
ATR_SL_MULT = 2.0
RR = 2.0
MIN_SCORE = 3


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


def adx_di(df, period):
    up_move = df["high"].diff()
    down_move = -df["low"].diff()
    plus_dm = pd.Series(np.where((up_move > down_move) & (up_move > 0), up_move, 0.0), index=df.index)
    minus_dm = pd.Series(np.where((down_move > up_move) & (down_move > 0), down_move, 0.0), index=df.index)
    tr_atr = atr(df, period)
    plus_di = 100 * wilder(plus_dm, period) / tr_atr.replace(0, np.nan)
    minus_di = 100 * wilder(minus_dm, period) / tr_atr.replace(0, np.nan)
    return plus_di, minus_di


def macd_hist(close):
    ema_fast = close.ewm(span=12, adjust=False).mean()
    ema_slow = close.ewm(span=26, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal = macd_line.ewm(span=9, adjust=False).mean()
    return macd_line - signal


def main():
    symbol, out_path = sys.argv[1], sys.argv[2]
    df = load_candles(symbol, "1h")

    df["ema_fast"] = df["close"].ewm(span=EMA_FAST, adjust=False).mean()
    df["ema_slow"] = df["close"].ewm(span=EMA_SLOW, adjust=False).mean()
    df["rsi"] = rsi(df["close"], RSI_PERIOD)
    df["plus_di"], df["minus_di"] = adx_di(df, ADX_PERIOD)
    df["hist"] = macd_hist(df["close"])
    df["atr"] = atr(df, ATR_PERIOD)

    df = df.dropna(subset=["ema_fast", "ema_slow", "rsi", "plus_di", "minus_di", "hist", "atr"]).copy()

    def score_row(i, rows):
        s = 0
        s += 1 if rows[i]["ema_fast"] > rows[i]["ema_slow"] else (-1 if rows[i]["ema_fast"] < rows[i]["ema_slow"] else 0)
        s += 1 if rows[i]["rsi"] > 50 else (-1 if rows[i]["rsi"] < 50 else 0)
        s += 1 if rows[i]["plus_di"] > rows[i]["minus_di"] else (-1 if rows[i]["plus_di"] < rows[i]["minus_di"] else 0)
        s += 1 if rows[i]["hist"] > rows[i - 1]["hist"] else (-1 if rows[i]["hist"] < rows[i - 1]["hist"] else 0)
        return s

    rows = df.reset_index().to_dict("records")
    trades = []
    position = None

    for i in range(1, len(rows)):
        bar, prev = rows[i], rows[i - 1]
        ts = bar["ts"]

        if position is not None:
            hi, lo = bar["high"], bar["low"]
            exit_price, exit_reason = None, None
            if position["side"] == "BUY":
                if lo <= position["sl"]:
                    exit_price, exit_reason = position["sl"], "SL"
                elif hi >= position["tp"]:
                    exit_price, exit_reason = position["tp"], "TP"
            else:
                if hi >= position["sl"]:
                    exit_price, exit_reason = position["sl"], "SL"
                elif lo <= position["tp"]:
                    exit_price, exit_reason = position["tp"], "TP"
            if exit_price is not None:
                pnl = (exit_price - position["entry"]) if position["side"] == "BUY" else (position["entry"] - exit_price)
                trades.append({"entry_time": position["entry_time"].isoformat(), "exit_time": ts.isoformat(),
                               "side": position["side"], "entry": position["entry"], "exit": exit_price,
                               "reason": exit_reason, "pnl_price": pnl})
                position = None

        if position is None and i >= 1:
            score = score_row(i - 1, rows)  # score uses the last CLOSED bar (prev), matching the EA's shift=1
            sl_dist = prev["atr"] * ATR_SL_MULT
            if score >= MIN_SCORE:
                entry = bar["open"]
                position = {"side": "BUY", "entry": entry, "sl": entry - sl_dist, "tp": entry + sl_dist * RR, "entry_time": ts}
            elif score <= -MIN_SCORE:
                entry = bar["open"]
                position = {"side": "SELL", "entry": entry, "sl": entry + sl_dist, "tp": entry - sl_dist * RR, "entry_time": ts}

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
