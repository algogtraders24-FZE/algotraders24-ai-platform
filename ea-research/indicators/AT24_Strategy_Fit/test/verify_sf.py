"""Independent check of the Strategy Fit core: recompute states (Regime AI centroids), the three rules, the trades, the
per-cell statistics and the luck test (xorshift32) with pandas/numpy from the OHLC columns of the MQL5 dump and compare.
Usage: python verify_sf.py <dir with SF_selftest_*.csv and SF_stats_*.csv>"""
import sys, glob, os, numpy as np, pandas as pd
MU = np.array([0.163863, -0.031967, 1.014311, 5.525808]); SD = np.array([0.119898, 0.26684, 0.766584, 1.932356])
CENT = np.array([[0.1023, 0.1663, 0.6141, 4.3468], [0.1219, -0.2405, 1.3098, 7.4327], [0.3395, -0.1325, 2.6010, 9.4282], [0.1197, -0.2249, 0.4958, 4.6743], [0.2955, 0.1396, 1.5741, 5.6380]])
HOLD, FIRST, MINN, FLIPS, SEED = 24, 250, 30, 3000, 20261118
M32 = 0xFFFFFFFF
def xs(x):
    x ^= (x << 13) & M32; x ^= x >> 17; x ^= (x << 5) & M32
    return x & M32
def cell(rv):
    m = len(rv)
    if m == 0: return dict(n=0, avg=0.0, hit=0.0, p=1.0, cls=2)
    a = np.array(rv); avg = a.mean(); hit = float((a > 0).mean())
    if m < MINN: return dict(n=m, avg=avg, hit=hit, p=1.0, cls=2)
    x = SEED; ge = 0
    for _ in range(FLIPS):
        fs = 0.0
        for v in rv:
            x = xs(x); fs += v if (x & 1) == 1 else -v
        if fs / m >= avg - 1e-12: ge += 1
    p = ge / FLIPS
    cls = 1 if (avg > 0 and p < 0.10) else (-1 if avg < 0 else 0)
    return dict(n=m, avg=avg, hit=hit, p=p, cls=cls)
d0 = sys.argv[1] if len(sys.argv) > 1 else "."
allok = True
for f in sorted(glob.glob(os.path.join(d0, "SF_selftest_*.csv"))):
    sym = os.path.basename(f).split("_")[2].split(".")[0]
    d = pd.read_csv(f); n = len(d)
    o, h, l, c = d.open.values, d.high.values, d.low.values, d.close.values
    cs = pd.Series(c); hs = pd.Series(h); ls = pd.Series(l)
    # signals
    e50 = cs.ewm(span=50, adjust=False).mean().values; e200 = cs.ewm(span=200, adjust=False).mean().values
    trend = np.where((c > e50) & (e50 > e200), 1, np.where((c < e50) & (e50 < e200), -1, 0))
    hh = hs.shift(1).rolling(20).max().values; ll = ls.shift(1).rolling(20).min().values
    brk = np.where(c > hh, 1, np.where(c < ll, -1, 0))
    dl = cs.diff(); u = dl.clip(lower=0).rolling(14).mean(); dn = (-dl.clip(upper=0)).rolling(14).mean()
    rsi = (100 - 100 / (1 + u / (dn + 1e-12))).values
    rev = np.where(rsi < 30, 1, np.where(rsi > 70, -1, 0))
    sig = np.column_stack([trend, brk, rev]); sig[:FIRST] = 0
    bad = int((sig != d[["sT", "sB", "sR"]].values).sum())
    # state check against the dumped atr / state with the Regime AI definition
    tr = pd.concat([hs - ls, (hs - cs.shift()).abs(), (ls - cs.shift()).abs()], axis=1).max(axis=1)
    a14 = tr.rolling(14).mean(); a100 = tr.rolling(100).mean()
    er = ((cs - cs.shift(48)).abs() / cs.diff().abs().rolling(48).sum())
    lv = np.log(a14 / a100)
    ema = cs.ewm(span=20, adjust=False).mean()
    sl = ((ema - ema.shift(10)).abs() / a14).clip(upper=6)
    rg = ((hs.rolling(24).max() - ls.rolling(24).min()) / a14).clip(upper=30)
    Z = (np.column_stack([er, lv, sl, rg]) - MU) / SD; ZC = (CENT - MU) / SD
    st = np.argmin(((Z[:, None, :] - ZC[None, :, :]) ** 2).sum(2), axis=1)
    valid = np.arange(n) >= 99
    st = np.where(valid, st, -1)
    stbad = int((st != d.state.values).sum())
    atr = a14.values
    for tag in ("s0", "s2"):
        ss = pd.read_csv(os.path.join(d0, f"SF_stats_{sym}_{tag}.csv")); cost = float(ss.cost.iloc[0]); stopAtr = float(ss.stop.iloc[0])
        cells = {(r, s): [] for r in range(3) for s in range(5)}; stp = {(r, s): 0 for r in range(3) for s in range(5)}; ntr = 0
        for r in range(3):
            last = -10 ** 9
            for i in range(FIRST, n - HOLD - 1):
                dirn = sig[i, r]
                if dirn == 0 or not valid[i] or st[i] < 0 or not (atr[i] > 0): continue
                if i - last < HOLD: continue
                last = i
                e0 = o[i + 1]; pnl = dirn * (o[i + 1 + HOLD] - e0); hit = False
                if stopAtr > 0:
                    sp = e0 - dirn * stopAtr * atr[i]
                    for j in range(i + 1, i + HOLD + 1):
                        tol = 1e-12 * max(1.0, abs(sp))
                        if (dirn > 0 and l[j] <= sp + tol) or (dirn < 0 and h[j] >= sp - tol):
                            pnl = dirn * (sp - e0); hit = True; break
                cells[(r, st[i])].append((pnl - cost) / atr[i]); stp[(r, st[i])] += int(hit); ntr += 1
        maxd = 0.0; cm = 0
        for _, row in ss.iterrows():
            k = cell(cells[(int(row.rule), int(row.state))])
            if k["n"] != row.n or k["cls"] != row.cls or stp[(int(row.rule), int(row.state))] != row.nStop: cm += 1
            maxd = max(maxd, abs(k["avg"] - row.avg), abs(k["hit"] - row.hit), abs(k["p"] - row.p))
        ok = bad == 0 and stbad == 0 and cm == 0 and maxd < 1e-6
        allok &= ok
        print(sym, tag, "stop", stopAtr, n, "signal mismatches", bad, "state mismatches", stbad, "trades", ntr, "stopped", sum(stp.values()), "cell n/class/stop mismatches", cm, "max diff avg/hit/p", f"{maxd:.1e}", "OK" if ok else "FAIL")
print("ALL OK" if allok else "SOME FAILED")
