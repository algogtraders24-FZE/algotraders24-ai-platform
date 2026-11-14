"""Sprint 2: long/short trend strategies, pre-registered in PREREG2.md. python -m binance_agents.research.sprint2"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from .sprint import DEV, HOLD, PPY, metrics, panels, simulate, sma, window


def sign_changes(w: pd.DataFrame) -> int:
    s = np.sign(w)
    return int(((s != s.shift(1).fillna(0)) & (s != 0)).sum().sum())


def spread_weights(sig: pd.DataFrame, per: float) -> pd.DataFrame:
    n = sig.abs().sum(axis=1).clip(lower=1)
    return sig.astype(float).mul(np.minimum(per, 1.0 / n), axis=0)


def s7(P):
    c, m = P["close"], sma(P["close"], 100)
    sig = pd.DataFrame(np.where(m.isna(), 0, np.where(c > m, 1, np.where(c < m, -1, 0))), index=c.index, columns=c.columns)
    return spread_weights(sig, 0.1)


def s8(P):
    c = P["close"]
    w = pd.DataFrame(0.0, index=c.index, columns=c.columns)
    m = sma(c["BTCUSDT"], 200)
    w["BTCUSDT"] = np.where(m.isna(), 0.0, np.where(c["BTCUSDT"] > m, 1.0, -1.0))
    return w


def s9(P):
    c = P["close"]
    score = (c / c.shift(30) - 1).to_numpy()
    avail = c.notna().rolling(60).sum().to_numpy() >= 60
    W = np.zeros(c.shape)
    cur = np.zeros(c.shape[1])
    for i, t in enumerate(c.index):
        if t.dayofweek == 6:
            cur = np.zeros(c.shape[1])
            row = np.where(avail[i] & ~np.isnan(score[i]), score[i], np.nan)
            ok = np.where(~np.isnan(row))[0]
            if len(ok) >= 12:
                order = ok[np.argsort(row[ok])]
                cur[order[:5]] = -0.1
                cur[order[-5:]] = 0.1
        W[i] = cur
    return pd.DataFrame(W, index=c.index, columns=c.columns)


STRATS = {"S7 trend long/short 1d": s7, "S8 BTC trend long/short 1d": s8, "S9 momentum long/short 1d": s9}
MIN_TRADES = {"S7 trend long/short 1d": 100, "S8 BTC trend long/short 1d": 30, "S9 momentum long/short 1d": 100}


def shifted(open_df, w, ppy, n=100, seed=11):
    rng, T, out = np.random.default_rng(seed), len(w), []
    for _ in range(n):
        k = int(rng.integers(int(T * 0.05), int(T * 0.95)))
        ws = pd.DataFrame(np.roll(w.to_numpy(), k, axis=0), index=w.index, columns=w.columns)
        out.append(metrics(window(simulate(open_df, ws), *HOLD), ppy).get("sharpe", 0.0))
    return np.array(out)


def yearly(r: pd.Series) -> dict:
    y = (1 + r).groupby(r.index.year).prod() - 1
    return {int(k): round(float(v) * 100, 1) for k, v in y.items()}


def main():
    P = panels("1D")
    ppy = PPY["1D"]
    rep, rows = {}, []
    for name, fn in STRATS.items():
        w = fn(P)
        r = simulate(P["open"], w)
        dev, hold = metrics(window(r, *DEV), ppy), metrics(window(r, *HOLD), ppy)
        p90 = float(np.percentile(shifted(P["open"], w, ppy), 90))
        n = sign_changes(w)
        A = hold.get("total_pct", -1) > 0 and hold.get("sharpe", -9) >= 0.7
        B = dev.get("sharpe", -9) >= 0.5
        C = dev.get("maxdd_pct", -99) >= -40 and hold.get("maxdd_pct", -99) >= -40
        D = hold.get("sharpe", -9) > p90
        E = n >= MIN_TRADES[name]
        net = w.sum(axis=1)
        rep[name] = {"dev": dev, "holdout": hold, "random_shift_p90_sharpe": round(p90, 2), "position_openings": n, "yearly_pct": yearly(r), "avg_gross": round(float(w.abs().sum(axis=1).mean()), 2),
                     "avg_net": round(float(net.mean()), 2), "A": A, "B": B, "C": C, "D": D, "E": E, "PASS": all([A, B, C, D, E])}
        rows.append((name, dev, hold, p90, n, A, B, C, D, E))
    btc = P["close"]["BTCUSDT"].pct_change().shift(-1).dropna()
    bench = {"BTC buy&hold": {"dev": metrics(window(btc, *DEV), 365), "holdout": metrics(window(btc, *HOLD), 365), "yearly_pct": yearly(btc)}}
    f = lambda m: f"ret {m.get('total_pct', 0):>7.1f}% DD {m.get('maxdd_pct', 0):>6.1f}% Sh {m.get('sharpe', 0):>5.2f}"
    print(f"{'strategy':28s} | {'DEV 2021-23':44s} | {'HOLDOUT 2024-now':44s} | rnd90 | opens | A B C D E | PASS")
    for name, dev, hold, p90, n, A, B, C, D, E in rows:
        print(f"{name:28s} | {f(dev):44s} | {f(hold):44s} | {p90:5.2f} | {n:5d} | {int(A)} {int(B)} {int(C)} {int(D)} {int(E)} | {'PASS' if all([A, B, C, D, E]) else 'no'}")
    print(f"{'BTC buy&hold':28s} | {f(bench['BTC buy&hold']['dev']):44s} | {f(bench['BTC buy&hold']['holdout']):44s}")
    print("yearly %:")
    for k, v in rep.items():
        print(f"  {k:28s} {v['yearly_pct']}  avg gross {v['avg_gross']} avg net {v['avg_net']}")
    print(f"  {'BTC buy&hold':28s} {bench['BTC buy&hold']['yearly_pct']}")
    Path(__file__).with_name("results2.json").write_text(json.dumps({"strategies": rep, "benchmarks": bench}, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
