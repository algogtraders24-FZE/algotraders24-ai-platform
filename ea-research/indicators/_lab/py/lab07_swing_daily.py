"""AT24 Research Lab 07 - four popular SWING-trading beliefs on DAILY bars, tested against the unconditional drift.

PRE-REGISTRATION (written 2026-11-16 BEFORE any result of this script was seen).
Data: BTCUSDT and ETHUSDT daily klines from Binance spot (first full year onward), XAUUSD daily built from the H1 file (2021-05-05 on, UTC days).
A trade return is the forward close-to-close return over H days from the signal close, long only, no costs (this tests the signal, not a system).
  W1 Trend:      close > SMA(50) AND SMA(50) > SMA(200)          ->  H = 10
  W2 Pullback:   uptrend (SMA(50) > SMA(200)) AND 3 consecutive down closes -> H = 5
  W3 Breakout:   close is the highest close of the last 20 days   ->  H = 10
  W4 Oversold:   RSI(14) (Wilder) < 30                              ->  H = 10
Events are made non-overlapping per asset and rule: after an event at day t the next event may start at day t+H.
Test: mean forward return of event days MINUS mean forward return of ALL other days with the same horizon (the unconditional drift),
two-sided permutation test (10000 shuffles of the labels over the same pooled returns).
Family = 4 rules x 3 assets = 12 tests, Bonferroni alpha = 0.05 / 12.
Periods: train = first 60 % of days, validation = next 20 %, final = last 20 % (by date). FINDING only if p_train < alpha AND the same sign in
validation with p_val < 0.05 AND the same sign in final (p_final < 0.10 or fewer than 15 events in final). Results are reported whatever they are.
"""
import json, sys, urllib.request, time
import numpy as np, pandas as pd

rng = np.random.default_rng(20261116)
H1 = "E:/at24_lab_data/lab_xauusd_h1.csv"
BONF = 0.05 / 12


def binance_daily(sym):
    rows, start = [], 1502928000000  # 2017-08-17
    while True:
        u = f"https://data-api.binance.vision/api/v3/klines?symbol={sym}&interval=1d&limit=1000&startTime={start}"
        with urllib.request.urlopen(u, timeout=30) as r:
            part = json.loads(r.read())
        if not part:
            break
        rows += part
        start = part[-1][0] + 86400000
        if len(part) < 1000:
            break
        time.sleep(0.2)
    df = pd.DataFrame(rows).iloc[:, :6]
    df.columns = ["t", "o", "h", "l", "c", "v"]
    df["t"] = pd.to_datetime(df["t"], unit="ms", utc=True)
    df[["o", "h", "l", "c"]] = df[["o", "h", "l", "c"]].astype(float)
    return df.iloc[:-1].reset_index(drop=True)  # drop today's open bar


def xau_daily():
    h = pd.read_csv(H1)
    h["utc"] = pd.to_datetime(h["gmt"], unit="s", utc=True)
    h["day"] = h["utc"].dt.floor("D")
    cnt = h.groupby("day").size()
    g = h.groupby("day").agg(o=("open", "first"), h=("high", "max"), l=("low", "min"), c=("close", "last"))
    g = g[cnt[g.index] >= 20]
    g = g.reset_index().rename(columns={"day": "t"})
    return g


def rsi_wilder(c, n=14):
    d = np.diff(c, prepend=c[0])
    up, dn = np.where(d > 0, d, 0.0), np.where(d < 0, -d, 0.0)
    au, ad = np.zeros(len(c)), np.zeros(len(c))
    au[n], ad[n] = up[1:n + 1].mean(), dn[1:n + 1].mean()
    for i in range(n + 1, len(c)):
        au[i] = (au[i - 1] * (n - 1) + up[i]) / n
        ad[i] = (ad[i - 1] * (n - 1) + dn[i]) / n
    rs = np.divide(au, ad, out=np.full(len(c), np.inf), where=ad > 0)
    r = 100 - 100 / (1 + rs)
    r[:n] = np.nan
    return r


def perm_diff(a, b, k=10000):
    a, b = np.asarray(a, float), np.asarray(b, float)
    d0 = a.mean() - b.mean()
    pool = np.concatenate([a, b])
    n = len(a)
    cnt = 0
    for _ in range(k):
        rng.shuffle(pool)
        if abs(pool[:n].mean() - pool[n:].mean()) >= abs(d0):
            cnt += 1
    return float(d0), float((1 + cnt) / (k + 1))


def run(name, df):
    c = df["c"].values
    n = len(c)
    s = pd.Series(c)
    sma50, sma200 = s.rolling(50).mean().values, s.rolling(200).mean().values
    hi20 = s.rolling(20).max().values
    rsi = rsi_wilder(c)
    down3 = np.zeros(n, bool)
    for i in range(3, n):
        down3[i] = c[i] < c[i - 1] < c[i - 2] < c[i - 3]
    rules = {
        "W1 trend": (lambda i: c[i] > sma50[i] and sma50[i] > sma200[i], 10),
        "W2 pullback": (lambda i: sma50[i] > sma200[i] and down3[i], 5),
        "W3 breakout": (lambda i: c[i] >= hi20[i] and not np.isnan(hi20[i]), 10),
        "W4 oversold": (lambda i: not np.isnan(rsi[i]) and rsi[i] < 30, 10),
    }
    t = df["t"].values
    i1, i2 = int(n * 0.6), int(n * 0.8)
    out = {}
    for rn, (cond, H) in rules.items():
        fwd = np.full(n, np.nan)
        fwd[:n - H] = (c[H:] / c[:n - H] - 1) * 100
        ev = np.zeros(n, bool)
        nxt = 200
        for i in range(200, n - H):
            if i >= nxt and cond(i):
                ev[i] = True
                nxt = i + H
        per = {}
        for pn, lo, hi in (("train", 200, i1), ("val", i1, i2), ("final", i2, n - H)):
            idx = np.arange(n)
            m = (idx >= lo) & (idx < hi) & ~np.isnan(fwd)
            a, b = fwd[m & ev], fwd[m & ~ev]
            if len(a) < 8:
                per[pn] = dict(n=int(len(a)), diff=0.0, p=1.0, mean_ev=None, mean_all=float(np.nanmean(fwd[m])))
                continue
            d0, p0 = perm_diff(a, b)
            per[pn] = dict(n=int(len(a)), mean_ev=float(a.mean()), mean_rest=float(b.mean()), diff=d0, p=p0)
        f = (per["train"]["p"] < BONF and per["val"]["p"] < 0.05 and per["train"]["diff"] * per["val"]["diff"] > 0 and per["train"]["diff"] * per["final"]["diff"] > 0 and (per["final"]["p"] < 0.10 or per["final"]["n"] < 15))
        out[rn] = dict(H=H, per=per, finding=bool(f))
    out["_span"] = [str(pd.Timestamp(t[0]).date()), str(pd.Timestamp(t[-1]).date()), int(n)]
    return out


R = {}
for name, df in (("BTCUSDT", binance_daily("BTCUSDT")), ("ETHUSDT", binance_daily("ETHUSDT")), ("XAUUSD", xau_daily())):
    R[name] = run(name, df)
    print(name, R[name]["_span"])
    for rn, v in R[name].items():
        if rn.startswith("_"):
            continue
        p = v["per"]
        print(f"  {rn:12s} H={v['H']:2d} FINDING={v['finding']}  " + "  ".join(f"{k}: n={p[k]['n']} diff={p[k]['diff']:+.2f}% p={p[k]['p']:.3f}" for k in ("train", "val", "final")))
json.dump(R, open(sys.argv[1] if len(sys.argv) > 1 else "lab07_results.json", "w"), indent=1)
