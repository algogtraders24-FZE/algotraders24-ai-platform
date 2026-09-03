"""
AT24 AI Trend Master (v1.00) - faithful Python port of the real
AT24_AI_Trend_Master.mq5 signal engine (macro H4 EMA trend filter, H1
EMA/ADX entry-timing gate, RSI pullback timing, ATR-adaptive SL/TP +
trailing), run against real candles already in quant_engine/market.db.

Usage: python trend_master_backtest.py <SYMBOL> <out_trades.json>
  e.g. python trend_master_backtest.py XAUUSD_EXNESS xauusd_trades.json
"""
import sqlite3
import sys
import json
import pandas as pd
import numpy as np

DB_PATH = r"E:\algotraders24-ai-platform\quant_engine\market.db"

MACRO_FAST, MACRO_SLOW = 50, 200
ENTRY_FAST, ENTRY_SLOW = 21, 55
ADX_PERIOD, ADX_MIN = 14, 25.0
RSI_PERIOD = 14
RSI_LO, RSI_HI = 40.0, 55.0
ATR_PERIOD = 14
ATR_SL_MULT, ATR_TP_MULT = 2.0, 3.0
TRAIL_ATR_MULT = 1.5
FIXED_LOT = 0.01


def load_candles(symbol: str, timeframe: str) -> pd.DataFrame:
    con = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query(
        "SELECT ts, open, high, low, close FROM candles WHERE symbol=? AND timeframe=? ORDER BY ts",
        con, params=(symbol, timeframe),
    )
    con.close()
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    return df.set_index("ts")


def ema(s, period): return s.ewm(span=period, adjust=False).mean()
def wilder(s, period): return s.ewm(alpha=1.0 / period, adjust=False).mean()


def rsi(close, period):
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    ag, al = wilder(gain, period), wilder(loss, period)
    rs = ag / al.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(50.0)


def atr(df, period):
    prev_close = df["close"].shift(1)
    tr = pd.concat([df["high"] - df["low"], (df["high"] - prev_close).abs(), (df["low"] - prev_close).abs()], axis=1).max(axis=1)
    return wilder(tr, period)


def adx(df, period):
    up = df["high"].diff()
    down = -df["low"].diff()
    plus_dm = np.where((up > down) & (up > 0), up, 0.0)
    minus_dm = np.where((down > up) & (down > 0), down, 0.0)
    a = atr(df, period)
    plus_di = 100 * wilder(pd.Series(plus_dm, index=df.index), period) / a
    minus_di = 100 * wilder(pd.Series(minus_dm, index=df.index), period) / a
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    return wilder(dx.fillna(0), period)


def main():
    symbol, out_path = sys.argv[1], sys.argv[2]
    h1 = load_candles(symbol, "1h")
    h4 = load_candles(symbol, "4h")

    h1["entry_f"] = ema(h1["close"], ENTRY_FAST)
    h1["entry_s"] = ema(h1["close"], ENTRY_SLOW)
    h1["adx"] = adx(h1, ADX_PERIOD)
    h1["rsi"] = rsi(h1["close"], RSI_PERIOD)
    h1["atr"] = atr(h1, ATR_PERIOD)

    h4["macro_f"] = ema(h4["close"], MACRO_FAST)
    h4["macro_s"] = ema(h4["close"], MACRO_SLOW)
    h4_aligned = h4[["macro_f", "macro_s"]].reindex(h1.index, method="ffill")
    h1["macro_f"] = h4_aligned["macro_f"]
    h1["macro_s"] = h4_aligned["macro_s"]

    h1 = h1.dropna(subset=["macro_s", "adx", "rsi", "atr"]).copy()
    rows = h1.reset_index().to_dict("records")

    trades = []
    position = None

    for i in range(2, len(rows)):
        bar, prev, prev2 = rows[i], rows[i - 1], rows[i - 2]
        ts = bar["ts"]

        if position is not None:
            hi, lo = bar["high"], bar["low"]
            exit_price, exit_reason = None, None
            if position["side"] == "BUY":
                if lo <= position["sl"]: exit_price, exit_reason = position["sl"], "SL"
                elif hi >= position["tp"]: exit_price, exit_reason = position["tp"], "TP"
            else:
                if hi >= position["sl"]: exit_price, exit_reason = position["sl"], "SL"
                elif lo <= position["tp"]: exit_price, exit_reason = position["tp"], "TP"

            if exit_price is not None:
                pnl = (exit_price - position["entry"]) if position["side"] == "BUY" else (position["entry"] - exit_price)
                trades.append({"entry_time": position["entry_time"].isoformat(), "exit_time": ts.isoformat(),
                               "side": position["side"], "entry": position["entry"], "exit": exit_price,
                               "reason": exit_reason, "pnl_price": pnl})
                position = None
            else:
                trail_dist = bar["atr"] * TRAIL_ATR_MULT
                close = bar["close"]
                if position["side"] == "BUY":
                    new_sl = close - trail_dist
                    if close > position["entry"] and new_sl > position["sl"]:
                        position["sl"] = new_sl
                else:
                    new_sl = close + trail_dist
                    if close < position["entry"] and new_sl < position["sl"]:
                        position["sl"] = new_sl

        if position is None:
            macro_trend = 1 if prev["macro_f"] > prev["macro_s"] else (-1 if prev["macro_f"] < prev["macro_s"] else 0)
            if macro_trend == 0:
                continue
            entry_up = prev["entry_f"] > prev["entry_s"]
            entry_down = prev["entry_f"] < prev["entry_s"]
            if prev["adx"] < ADX_MIN:
                continue
            pullback = RSI_LO <= prev["rsi"] <= RSI_HI
            entry_price = bar["open"]
            sl_dist = prev["atr"] * ATR_SL_MULT
            tp_dist = prev["atr"] * ATR_TP_MULT

            if macro_trend == 1 and entry_up and pullback and prev["rsi"] > prev2["rsi"]:
                position = {"side": "BUY", "entry": entry_price, "sl": entry_price - sl_dist, "tp": entry_price + tp_dist, "entry_time": ts}
            elif macro_trend == -1 and entry_down and pullback and prev["rsi"] < prev2["rsi"]:
                position = {"side": "SELL", "entry": entry_price, "sl": entry_price + sl_dist, "tp": entry_price - tp_dist, "entry_time": ts}

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
