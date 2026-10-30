"""Research sprint: six pre-registered strategies (see PREREG.md) on the cached Binance candles. Vectorised signals -> target weights -> next-open execution
with costs. python -m binance_agents.research.sprint"""
from __future__ import annotations

import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

from ..config import DEFAULT_UNIVERSE

warnings.filterwarnings("ignore")
CACHE = Path(__file__).resolve().parents[1] / "data_cache"
COST = 0.0010 + 0.0005            # fee + slippage per unit of turnover
DEV = ("2021-01-01", "2023-12-31")
HOLD = ("2024-01-01", "2026-12-31")


# ------------------------------------------------------------------ data
def panels(rule: str) -> dict[str, pd.DataFrame]:
    cols: dict[str, dict[str, pd.Series]] = {k: {} for k in ("open", "high", "low", "close", "volume")}
    for s in DEFAULT_UNIVERSE:
        f = CACHE / f"{s}_1h.csv"
        if not f.exists():
            continue
        d = pd.read_csv(f, parse_dates=["open_time"])
        d["open_time"] = pd.to_datetime(d["open_time"], utc=True)
        d = d.set_index("open_time")
        r = d.resample(rule, label="left", closed="left").agg({"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"}).dropna(subset=["open"])
        for k in cols:
            cols[k][s] = r[k]
    return {k: pd.DataFrame(v).sort_index() for k, v in cols.items()}


def sma(x, n):
    return x.rolling(n).mean()


def rsi(c: pd.DataFrame, n: int = 2) -> pd.DataFrame:
    d = c.diff()
    up, dn = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean(), (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    return 100 - 100 / (1 + up / dn)


def atr(P: dict, n: int = 14) -> pd.DataFrame:
    pc = P["close"].shift(1)
    tr = np.maximum(P["high"] - P["low"], np.maximum((P["high"] - pc).abs(), (P["low"] - pc).abs()))
    return tr.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


# ------------------------------------------------------------------ engine
def simulate(open_df: pd.DataFrame, w: pd.DataFrame) -> pd.Series:
    """w[t] = target weights decided at the CLOSE of bar t, held from the open of t+1 to the open of t+2. Returns net per-bar returns (index = t)."""
    ret_next = open_df.shift(-2) / open_df.shift(-1) - 1.0
    w = w.reindex(index=open_df.index, columns=open_df.columns).fillna(0.0)
    gross = (w * ret_next.fillna(0.0)).sum(axis=1)
    turn = (w - w.shift(1).fillna(0.0)).abs().sum(axis=1)
    return (gross - turn * COST).iloc[:-2]


def entries(w: pd.DataFrame) -> int:
    on = (w > 0)
    return int((on & ~on.shift(1, fill_value=False)).sum().sum())


def metrics(r: pd.Series, ppy: float) -> dict:
    r = r.dropna()
    if len(r) < 30:
        return {"n": len(r)}
    eq = (1 + r).cumprod()
    tot = float(eq.iloc[-1] - 1)
    dd = float((eq / eq.cummax() - 1).min())
    sd = r.std()
    return {"n": len(r), "total_pct": round(tot * 100, 1), "maxdd_pct": round(dd * 100, 1), "sharpe": round(float(r.mean() / sd * np.sqrt(ppy)), 2) if sd > 0 else 0.0}


def window(r: pd.Series, a: str, b: str) -> pd.Series:
    return r[(r.index >= pd.Timestamp(a, tz="UTC")) & (r.index <= pd.Timestamp(b, tz="UTC"))]


# ------------------------------------------------------------------ strategies (weights)
def cap_weights(sig: pd.DataFrame, per: float) -> pd.DataFrame:
    n = sig.sum(axis=1).clip(lower=1)
    return sig.astype(float).mul(np.minimum(per, 1.0 / n), axis=0)


def s1(P):
    c = P["close"]
    score = c / c.shift(30) - 1
    ok = (c["BTCUSDT"] > sma(c["BTCUSDT"], 200)).to_numpy()
    W = np.zeros(c.shape)
    cur = np.zeros(c.shape[1])
    sc = score.to_numpy()
    for i, t in enumerate(c.index):
        if t.dayofweek == 6:
            cur = np.zeros(c.shape[1])
            if ok[i]:
                row = sc[i].copy()
                row[np.isnan(row)] = -9
                idx = [j for j in np.argsort(-row)[:5] if row[j] > 0]
                for j in idx:
                    cur[j] = 1.0 / 5
        W[i] = cur
    return pd.DataFrame(W, index=c.index, columns=c.columns)


def s2(P):
    c = P["close"]
    return cap_weights((c > sma(c, 100)).fillna(False), 0.1)


def s3(P):
    c = P["close"]
    w = pd.DataFrame(0.0, index=c.index, columns=c.columns)
    w["BTCUSDT"] = (c["BTCUSDT"] > sma(c["BTCUSDT"], 200)).astype(float)
    return w


def s4(P):
    c = P["close"]
    r2, up = rsi(c, 2).to_numpy(), (c > sma(c, 200)).to_numpy()
    pos = np.zeros(c.shape)
    for j in range(c.shape[1]):
        held = 0
        for i in range(len(c)):
            if held:
                held += 1
                if r2[i, j] > 70 or held > 7:
                    held = 0
            elif up[i, j] and r2[i, j] < 10:
                held = 1
            pos[i, j] = 1.0 if held else 0.0
    return cap_weights(pd.DataFrame(pos > 0, index=c.index, columns=c.columns), 0.1)


def s5(P):
    c = P["close"]
    mid, sd = sma(c, 20), c.rolling(20).std()
    up, bw = mid + 2 * sd, (4 * sd) / mid
    squeeze = bw <= bw.rolling(100).quantile(0.10)
    recent = squeeze.shift(1).rolling(3).max().fillna(0) > 0
    entry = ((c > up) & recent).to_numpy()
    a, cl, md = atr(P).to_numpy(), c.to_numpy(), mid.to_numpy()
    pos = np.zeros(c.shape)
    for j in range(c.shape[1]):
        held, hh = False, 0.0
        for i in range(len(c)):
            if held:
                hh = max(hh, cl[i, j])
                if cl[i, j] < md[i, j] or cl[i, j] < hh - 3 * a[i, j]:
                    held = False
            elif entry[i, j] and not np.isnan(a[i, j]):
                held, hh = True, cl[i, j]
            pos[i, j] = 1.0 if held else 0.0
    return cap_weights(pd.DataFrame(pos > 0, index=c.index, columns=c.columns), 0.1)


def s6(P):
    c = P["close"]
    return cap_weights(((c > sma(c, 50)) & (c / c.shift(90) - 1 > 0)).fillna(False), 0.1)


STRATS = {"S1 xs-momentum 1d": (s1, "1D"), "S2 trend>SMA100 1d": (s2, "1D"), "S3 BTC trend 1d": (s3, "1D"), "S4 RSI2 dip uptrend 1d": (s4, "1D"),
          "S5 squeeze breakout 4h": (s5, "4h"), "S6 broad trend 1d": (s6, "1D")}
PPY = {"1D": 365.0, "4h": 2190.0}


def shifted_sharpes(open_df, w, ppy, n=100, seed=7):
    rng = np.random.default_rng(seed)
    out, T = [], len(w)
    for _ in range(n):
        k = int(rng.integers(int(T * 0.05), int(T * 0.95)))
        ws = pd.DataFrame(np.roll(w.to_numpy(), k, axis=0), index=w.index, columns=w.columns)
        m = metrics(window(simulate(open_df, ws), *HOLD), ppy)
        out.append(m.get("sharpe", 0.0))
    return np.array(out)


def main():
    PB = {"1D": panels("1D"), "4h": panels("4h")}
    rows, report = [], {}
    for name, (fn, rule) in STRATS.items():
        P = PB[rule]
        w = fn(P)
        r = simulate(P["open"], w)
        ppy = PPY[rule]
        dev, hold = metrics(window(r, *DEV), ppy), metrics(window(r, *HOLD), ppy)
        rnd = shifted_sharpes(P["open"], w, ppy)
        p90 = float(np.percentile(rnd, 90))
        n_entries = entries(w)
        A = hold.get("total_pct", -1) > 0 and hold.get("sharpe", -9) >= 0.7
        B = dev.get("sharpe", -9) >= 0.5
        C = dev.get("maxdd_pct", -99) >= -40 and hold.get("maxdd_pct", -99) >= -40
        D = hold.get("sharpe", -9) > p90
        E = n_entries >= 100
        report[name] = {"dev": dev, "holdout": hold, "random_shift_p90_sharpe": round(p90, 2), "entries": n_entries, "A": A, "B": B, "C": C, "D": D, "E": E, "PASS": all([A, B, C, D, E])}
        rows.append((name, dev, hold, p90, n_entries, A, B, C, D, E))
    # benchmarks
    d = PB["1D"]
    btc = d["close"]["BTCUSDT"].pct_change().shift(-1).dropna()
    basket = d["close"].pct_change().shift(-1).mean(axis=1).dropna()
    bench = {"BTC buy&hold": {"dev": metrics(window(btc, *DEV), 365), "holdout": metrics(window(btc, *HOLD), 365)}, "basket buy&hold": {"dev": metrics(window(basket, *DEV), 365), "holdout": metrics(window(basket, *HOLD), 365)}}
    f = lambda m: f"ret {m.get('total_pct', 0):>7.1f}% DD {m.get('maxdd_pct', 0):>6.1f}% Sh {m.get('sharpe', 0):>5.2f}"
    print(f"{'strategy':26s} | {'DEV 2021-23':44s} | {'HOLDOUT 2024-now':44s} | rnd90 | entries | A B C D E | PASS")
    for name, dev, hold, p90, ne, A, B, C, D, E in rows:
        print(f"{name:26s} | {f(dev):44s} | {f(hold):44s} | {p90:5.2f} | {ne:7d} | {int(A)} {int(B)} {int(C)} {int(D)} {int(E)} | {'PASS' if all([A, B, C, D, E]) else 'no'}")
    for k, v in bench.items():
        print(f"{k:26s} | {f(v['dev']):44s} | {f(v['holdout']):44s}")
    out = Path(__file__).with_name("results.json")
    out.write_text(json.dumps({"strategies": report, "benchmarks": bench}, indent=2), encoding="utf-8")
    print("written", out)


if __name__ == "__main__":
    main()
