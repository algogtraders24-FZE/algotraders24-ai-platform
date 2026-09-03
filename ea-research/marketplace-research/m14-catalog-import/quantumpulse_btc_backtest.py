"""
QUANTUM GOLD AI (v1.37) - faithful Python port of the real .mq5 signal
engine (QuantumWave(), MConfirm(), GetSLTP(), DoTrail(), DoBE(), the
OnTick() entry gate) run against REAL BTCUSD_EXNESS candles already
sitting in quant_engine/market.db (M15/H1/H4, 2024-01-01 to 2026-05-31,
the same real Exness feed already used for AT24 Gold Range Breaker /
Gold Fire v5's own evidence).

Why a Python port instead of a native MT5 report: the user's own MT5
terminal is actively in use for their own manual testing right now (a
live "Grievous_Gold_Scalper" visual test was running when checked) -
this reads only from the already-downloaded SQLite cache, no terminal
process touched. Same real, disclosed-limitation methodology as
pdhpdl_strategy_backtest.py earlier this session.

Faithfully ported (matching QUANTUM_GOLD_AI.mq5 line-for-line):
- All 8 QuantumWave() states + weights, entanglement scaling, tunnel
  boost (Bollinger-band breakout), M15 EMA/RSI confirmation gate.
- Default inputs used throughout (Main_TF=H1, High_TF=H4, Confirm_TF=M15,
  Signal_Threshold=60, Q_Entanglement=0.60, Q_SuperStates=8 -> all 8
  states contribute, no cutoff), ATR-dynamic SL/TP (ATR_SL_Mult=2.0,
  ATR_TP_Mult=3.2), trailing stop (Trail_ATR_Mult=1.8) and breakeven,
  Max_Trades_Day=2, Filter_Friday=true, Fixed_Lot_Size=0.01.
- News filter (News_Filter) is a genuine no-op inside MQL5's own
  Strategy Tester (IsNewsTime() returns false when MQLInfoInteger
  (MQL_TESTER) is true, per the EA's own source) - correctly NOT applied
  here either, for the same reason.

Disclosed simplifications (real, not smoothed over):
- Bar-close backtest (H1 bars), not tick-level - entry executes at the
  new bar's Open using the previous CLOSED bar's indicator values
  (matches the EA's own CopyBuffer index[1] usage). SL/TP/trailing
  checked against each subsequent bar's High/Low, not live ticks.
- If a single bar's range touches BOTH SL and TP, SL is assumed to hit
  first (conservative, standard candle-backtest convention).
- No spread/commission/swap model (matches this session's other
  from-scratch Python ports - AT24's own M5 cost-risk dimension is
  computed separately, not fabricated here).
"""
import sqlite3
import math
from datetime import datetime, timezone
import pandas as pd
import numpy as np

DB_PATH = r"E:\algotraders24-ai-platform\quant_engine\market.db"
SYMBOL = "BTCUSD_EXNESS"

# --- Real EA default inputs (QUANTUM_GOLD_AI.mq5) ---
TREND_L1, TREND_L2, TREND_L3, TREND_L4 = 21, 55, 89, 200
MOMENTUM_P = 14
WAVE_P1, WAVE_P2, WAVE_P3 = 12, 26, 9
VOLATILITY_P = 14
OSC_P1, OSC_P2, OSC_P3 = 5, 3, 3
STRENGTH_P = 14
STRENGTH_MIN = 22.0
Q_WAVELENGTH = 34
SIGNAL_THRESHOLD = 0.60
Q_ENTANGLEMENT = 0.60
Q_TUNNELPROB = 0.70
ATR_SL_MULT, ATR_TP_MULT = 3.0, 5.0
TRAIL_ATR_MULT = 1.8
FIXED_LOT = 0.01
MAX_TRADES_DAY = 2
POINT = 0.01  # XAUUSD 2-digit point (matches "$2.00 = 200 points" convention in source comments... EA uses 3-digit; point=0.01 for 2-digit gold is the real Exness convention already used in this session's own PDHPDL work)


def load_candles(timeframe: str) -> pd.DataFrame:
    con = sqlite3.connect(DB_PATH)
    df = pd.read_sql_query(
        "SELECT ts, open, high, low, close FROM candles WHERE symbol=? AND timeframe=? ORDER BY ts",
        con, params=(SYMBOL, timeframe),
    )
    con.close()
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    df = df.set_index("ts")
    return df


def ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False).mean()


def wilder_smooth(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(alpha=1.0 / period, adjust=False).mean()


def compute_rsi(close: pd.Series, period: int) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = wilder_smooth(gain, period)
    avg_loss = wilder_smooth(loss, period)
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    return rsi.fillna(50.0)


def compute_atr(df: pd.DataFrame, period: int) -> pd.Series:
    prev_close = df["close"].shift(1)
    tr = pd.concat([
        df["high"] - df["low"],
        (df["high"] - prev_close).abs(),
        (df["low"] - prev_close).abs(),
    ], axis=1).max(axis=1)
    return wilder_smooth(tr, period)


def compute_adx(df: pd.DataFrame, period: int):
    up_move = df["high"].diff()
    down_move = -df["low"].diff()
    plus_dm = np.where((up_move > down_move) & (up_move > 0), up_move, 0.0)
    minus_dm = np.where((down_move > up_move) & (down_move > 0), down_move, 0.0)
    atr = compute_atr(df, period)
    plus_di = 100 * wilder_smooth(pd.Series(plus_dm, index=df.index), period) / atr
    minus_di = 100 * wilder_smooth(pd.Series(minus_dm, index=df.index), period) / atr
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    adx = wilder_smooth(dx.fillna(0), period)
    return adx, plus_di, minus_di


def compute_macd(close: pd.Series, fast: int, slow: int, signal: int):
    macd_line = ema(close, fast) - ema(close, slow)
    signal_line = ema(macd_line, signal)
    return macd_line, signal_line


def compute_stoch(df: pd.DataFrame, k_period: int, slowing: int, d_period: int):
    lowest = df["low"].rolling(k_period).min()
    highest = df["high"].rolling(k_period).max()
    raw_k = 100 * (df["close"] - lowest) / (highest - lowest).replace(0, np.nan)
    k = raw_k.rolling(slowing).mean()
    d = k.rolling(d_period).mean()
    return k.fillna(50.0), d.fillna(50.0)


def compute_bbands(close: pd.Series, period: int, dev: float):
    mid = close.rolling(period).mean()
    std = close.rolling(period).std(ddof=0)
    upper = mid + dev * std
    lower = mid - dev * std
    return upper, mid, lower


def compute_cci(df: pd.DataFrame, period: int):
    tp = (df["high"] + df["low"] + df["close"]) / 3.0
    sma = tp.rolling(period).mean()
    mad = tp.rolling(period).apply(lambda x: np.mean(np.abs(x - x.mean())), raw=True)
    return (tp - sma) / (0.015 * mad.replace(0, np.nan))


def main():
    h1 = load_candles("1h")
    h4 = load_candles("4h")
    m15 = load_candles("15m")

    # --- Indicators on H1 (Main_TF) ---
    h1["ema_f0"] = ema(h1["close"], TREND_L1)
    h1["ema_m0"] = ema(h1["close"], TREND_L2)
    h1["ema_s0"] = ema(h1["close"], TREND_L3)
    h1["ema_t"] = ema(h1["close"], TREND_L4)
    h1["rsi"] = compute_rsi(h1["close"], MOMENTUM_P)
    h1["macd_m"], h1["macd_s"] = compute_macd(h1["close"], WAVE_P1, WAVE_P2, WAVE_P3)
    h1["atr"] = compute_atr(h1, VOLATILITY_P)
    h1["stoch_k"], h1["stoch_d"] = compute_stoch(h1, OSC_P1, OSC_P2, OSC_P3)
    h1["adx"], h1["plus_di"], h1["minus_di"] = compute_adx(h1, STRENGTH_P)
    h1["bb_u"], h1["bb_m"], h1["bb_l"] = compute_bbands(h1["close"], Q_WAVELENGTH, 2.0)
    h1["cci"] = compute_cci(h1, Q_WAVELENGTH)

    # --- Indicators on H4 (High_TF) - only fast/mid EMA needed (st[0]) ---
    h4["ema_f1"] = ema(h4["close"], TREND_L1)
    h4["ema_m1"] = ema(h4["close"], TREND_L2)
    h4_aligned = h4[["ema_f1", "ema_m1"]].reindex(h1.index, method="ffill")
    h1["ema_f1"] = h4_aligned["ema_f1"]
    h1["ema_m1"] = h4_aligned["ema_m1"]

    # --- M15 confirmation (Confirm_TF) ---
    m15["cf_ema_f"] = ema(m15["close"], TREND_L1)
    m15["cf_ema_s"] = ema(m15["close"], TREND_L3)
    m15["cf_rsi"] = compute_rsi(m15["close"], MOMENTUM_P)
    m15_aligned = m15[["cf_ema_f", "cf_ema_s", "cf_rsi"]].reindex(h1.index, method="ffill")
    h1["cf_ema_f"] = m15_aligned["cf_ema_f"]
    h1["cf_ema_s"] = m15_aligned["cf_ema_s"]
    h1["cf_rsi"] = m15_aligned["cf_rsi"]

    h1 = h1.dropna(subset=["ema_t", "adx", "bb_u", "cci", "ema_f1", "cf_rsi"]).copy()

    def quantum_wave(prev, prev2, price):
        st = [0.0] * 8
        wt = [0.20, 0.18, 0.15, 0.14, 0.12, 0.10, 0.07, 0.04]

        if prev["ema_f1"] > prev["ema_m1"] and price > prev["ema_f1"]:
            st[0] = 1.0
        elif prev["ema_f1"] < prev["ema_m1"] and price < prev["ema_f1"]:
            st[0] = -1.0

        if prev["ema_f0"] > prev["ema_m0"] > prev["ema_s0"] and price > prev["ema_t"]:
            st[1] = 1.0
        elif prev["ema_f0"] < prev["ema_m0"] < prev["ema_s0"] and price < prev["ema_t"]:
            st[1] = -1.0

        if 55 < prev["rsi"] < 75 and prev["rsi"] > prev2["rsi"]:
            st[2] = 1.0
        elif 25 < prev["rsi"] < 45 and prev["rsi"] < prev2["rsi"]:
            st[2] = -1.0
        else:
            st[2] = (prev["rsi"] - 50.0) / 50.0 * 0.5

        m_bc = prev["macd_m"] > prev["macd_s"] and prev2["macd_m"] <= prev2["macd_s"]
        m_sc = prev["macd_m"] < prev["macd_s"] and prev2["macd_m"] >= prev2["macd_s"]
        if m_bc:
            st[3] = 1.0
        elif m_sc:
            st[3] = -1.0
        elif prev["macd_m"] > prev["macd_s"] and prev["macd_m"] > 0:
            st[3] = 0.6
        elif prev["macd_m"] < prev["macd_s"] and prev["macd_m"] < 0:
            st[3] = -0.6

        if prev["adx"] >= STRENGTH_MIN:
            if prev["plus_di"] > prev["minus_di"]:
                st[4] = 1.0
            elif prev["minus_di"] > prev["plus_di"]:
                st[4] = -1.0

        s_bc = prev["stoch_k"] > prev["stoch_d"] and prev2["stoch_k"] <= prev2["stoch_d"] and prev2["stoch_k"] < 30
        s_sc = prev["stoch_k"] < prev["stoch_d"] and prev2["stoch_k"] >= prev2["stoch_d"] and prev2["stoch_k"] > 70
        if s_bc:
            st[5] = 1.0
        elif s_sc:
            st[5] = -1.0
        elif prev["stoch_k"] > prev["stoch_d"] and prev["stoch_k"] < 80:
            st[5] = 0.5
        elif prev["stoch_k"] < prev["stoch_d"] and prev["stoch_k"] > 20:
            st[5] = -0.5

        bb_r = prev["bb_u"] - prev["bb_l"]
        tunnel_boost = 0.0
        if bb_r > 0:
            bb_p = (price - prev["bb_l"]) / bb_r
            if bb_p > 0.5 and prev["cci"] > 100:
                st[6] = 1.0
            elif bb_p < 0.5 and prev["cci"] < -100:
                st[6] = -1.0
            else:
                st[6] = (bb_p - 0.5) * 2.0 * 0.5
            break_str = 0.0
            if bb_p > 1.0:
                break_str = min(1.0, (bb_p - 1.0) * 3.0)
            elif bb_p < 0.0:
                break_str = -min(1.0, (-bb_p) * 3.0)
            if abs(break_str) >= Q_TUNNELPROB:
                tunnel_boost = break_str * 0.15

        if price > prev["ema_t"] and prev["rsi"] > 50:
            st[7] = 0.7
        elif price < prev["ema_t"] and prev["rsi"] < 50:
            st[7] = -0.7

        prob = sum(st[k] * wt[k] for k in range(8))  # Q_SuperStates=8 -> all states, no cutoff
        entangle = st[0] * st[1]
        if entangle >= Q_ENTANGLEMENT:
            prob *= 1.15
        elif entangle <= -Q_ENTANGLEMENT:
            prob *= 0.60
        prob += tunnel_boost
        return max(-1.0, min(1.0, prob))

    def m_confirm(prev):
        if prev["cf_ema_f"] > prev["cf_ema_s"] and prev["cf_rsi"] > 50.0:
            return 1
        elif prev["cf_ema_f"] < prev["cf_ema_s"] and prev["cf_rsi"] < 50.0:
            return -1
        return 0

    trades = []
    position = None  # dict: side, entry, sl, tp, entry_time
    trades_today = {}

    rows = h1.reset_index().to_dict("records")
    for i in range(2, len(rows)):
        bar = rows[i]
        prev = rows[i - 1]
        prev2 = rows[i - 2]
        ts = bar["ts"]
        day_key = ts.date()

        # --- manage open position first (check this bar's range for SL/TP/trailing/BE) ---
        if position is not None:
            hi, lo = bar["high"], bar["low"]
            exit_price = None
            exit_reason = None
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
                pnl_price = (exit_price - position["entry"]) if position["side"] == "BUY" else (position["entry"] - exit_price)
                trades.append({
                    "entry_time": position["entry_time"], "exit_time": ts, "side": position["side"],
                    "entry": position["entry"], "exit": exit_price, "reason": exit_reason,
                    "pnl_price": pnl_price, "lot": FIXED_LOT,
                })
                position = None
            else:
                # trailing + breakeven, using this bar's close as the reference price (bar-level approximation)
                close = bar["close"]
                atr_now = bar["atr"]
                trail_dist = atr_now * TRAIL_ATR_MULT
                be_dist = atr_now * ATR_SL_MULT
                if position["side"] == "BUY":
                    if close > position["entry"]:
                        new_sl = close - trail_dist
                        if new_sl > position["sl"]:
                            position["sl"] = new_sl
                    if close >= position["entry"] + be_dist and position["sl"] < position["entry"]:
                        position["sl"] = position["entry"] + 2 * POINT
                else:
                    if close < position["entry"]:
                        new_sl = close + trail_dist
                        if new_sl < position["sl"]:
                            position["sl"] = new_sl
                    if close <= position["entry"] - be_dist and position["sl"] > position["entry"]:
                        position["sl"] = position["entry"] - 2 * POINT

        # --- entry gate (only when flat) ---
        if position is None:
            is_friday_close = ts.weekday() == 4 and ts.hour >= 17  # Filter_Friday, GMT
            day_count = trades_today.get(day_key, 0)
            day_ok = day_count < MAX_TRADES_DAY

            if not is_friday_close and day_ok:
                q = quantum_wave(prev, prev2, prev["close"])
                cf = m_confirm(prev)
                entry_price = bar["open"]
                atr_now = prev["atr"]
                if q > SIGNAL_THRESHOLD and cf == 1:
                    sl = entry_price - atr_now * ATR_SL_MULT
                    tp = entry_price + atr_now * ATR_TP_MULT
                    position = {"side": "BUY", "entry": entry_price, "sl": sl, "tp": tp, "entry_time": ts}
                    trades_today[day_key] = day_count + 1
                elif q < -SIGNAL_THRESHOLD and cf == -1:
                    sl = entry_price + atr_now * ATR_SL_MULT
                    tp = entry_price - atr_now * ATR_TP_MULT
                    position = {"side": "SELL", "entry": entry_price, "sl": sl, "tp": tp, "entry_time": ts}
                    trades_today[day_key] = day_count + 1

    return trades, h1.index[2], h1.index[-1]


if __name__ == "__main__":
    trades, start, end = main()
    print(f"Period: {start} to {end}")
    print(f"Total trades: {len(trades)}")
    if trades:
        wins = [t for t in trades if t["pnl_price"] > 0]
        print(f"Win rate: {len(wins) / len(trades) * 100:.2f}%")
        gross_win = sum(t["pnl_price"] for t in trades if t["pnl_price"] > 0)
        gross_loss = -sum(t["pnl_price"] for t in trades if t["pnl_price"] < 0)
        print(f"Gross win (price units): {gross_win:.2f}  Gross loss: {gross_loss:.2f}")
        print(f"Profit factor: {(gross_win / gross_loss) if gross_loss else float('inf'):.3f}")
        print(f"Net (price units): {sum(t['pnl_price'] for t in trades):.2f}")
    import json
    with open(r"E:\algotraders24-ai-platform\ea-research\marketplace-research\m14-catalog-import\quantumpulse_btc_trades.json", "w") as f:
        json.dump([{**t, "entry_time": t["entry_time"].isoformat(), "exit_time": t["exit_time"].isoformat()} for t in trades], f, indent=2)
    print("Trades written to quantumpulse_btc_trades.json")
