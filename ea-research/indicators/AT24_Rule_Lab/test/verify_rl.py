"""Independent check of the Rule Lab core: recompute the six rules (KAMA, FRAMA, HMA, TSI, Vortex, Squeeze) with pandas/numpy from the OHLC columns of the MQL5 dump,
the Regime AI states, the trades (optional stop) and every cell statistic incl. the xorshift32 luck test, and compare.
Usage: python verify_rl.py <dir with RL_selftest_*.csv and RL_stats_*_s0/s2.csv>"""
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
    a = np.array(rv); avg = float(a.mean()); hit = float((a > 0).mean())
    if m < MINN: return dict(n=m, avg=avg, hit=hit, p=1.0, cls=2)
    x = SEED; ge = 0
    for _ in range(FLIPS):
        fs = 0.0
        for v in rv:
            x = xs(x); fs += v if (x & 1) == 1 else -v
        if fs / m >= avg - 1e-12: ge += 1
    p = ge / FLIPS
    return dict(n=m, avg=avg, hit=hit, p=p, cls=1 if (avg > 0 and p < 0.10) else (-1 if avg < 0 else 0))
def wma(s, n):
    w = np.arange(1, n + 1)
    return s.rolling(n).apply(lambda x: np.dot(x, w) / w.sum(), raw=True)
def signals(h, l, c):
    n = len(c); hs, ls, cs = pd.Series(h), pd.Series(l), pd.Series(c)
    tr = pd.concat([hs - ls, (hs - cs.shift()).abs(), (ls - cs.shift()).abs()], axis=1).max(axis=1)
    den = cs.diff().abs().rolling(10).sum(); er = (cs - cs.shift(10)).abs() / den
    sc = ((er * (2 / 3 - 2 / 31) + 2 / 31) ** 2).values
    kama = np.full(n, np.nan); kama[0] = c[0]
    for i in range(1, n):
        s = sc[i] if not np.isnan(sc[i]) and not np.isinf(sc[i]) else (2 / 31) ** 2
        kama[i] = kama[i - 1] + s * (c[i] - kama[i - 1])
    def trendrule(m): return np.where((c > m) & (m > np.roll(m, 1)), 1, np.where((c < m) & (m < np.roll(m, 1)), -1, 0))
    fr = np.full(n, np.nan); fr[0] = c[0]; N, half = 16, 8
    for i in range(1, n):
        if i < N: fr[i] = c[i]; continue
        n1 = (h[i - half + 1:i + 1].max() - l[i - half + 1:i + 1].min()) / half
        n2 = (h[i - N + 1:i - half + 1].max() - l[i - N + 1:i - half + 1].min()) / half
        n3 = (h[i - N + 1:i + 1].max() - l[i - N + 1:i + 1].min()) / N
        if n1 > 0 and n2 > 0 and n3 > 0:
            D = (np.log(n1 + n2) - np.log(n3)) / np.log(2); a = float(np.clip(np.exp(-4.6 * (D - 1)), 0.01, 1.0))
        else: a = 0.5
        fr[i] = a * c[i] + (1 - a) * fr[i - 1]
    hma = wma(2 * wma(cs, 10) - wma(cs, 21), 4).values
    m = cs.diff(); t1 = m.ewm(span=25, adjust=False).mean().ewm(span=13, adjust=False).mean(); t2 = m.abs().ewm(span=25, adjust=False).mean().ewm(span=13, adjust=False).mean()
    tsi = 100 * t1 / (t2 + 1e-12); tsg = tsi.ewm(span=7, adjust=False).mean()
    sT = np.where(tsi > tsg, 1, np.where(tsi < tsg, -1, 0))
    vp = (hs - ls.shift()).abs().rolling(14).sum() / tr.rolling(14).sum(); vm = (ls - hs.shift()).abs().rolling(14).sum() / tr.rolling(14).sum()
    sV = np.where(vp - vm > 1e-12, 1, np.where(vp - vm < -1e-12, -1, 0))
    basis = cs.rolling(20).mean(); dev = 2 * cs.rolling(20).std(ddof=0); atr20 = tr.rolling(20).mean()
    sqz = (dev < 1.5 * atr20)
    mid = ((hs.rolling(20).max() + ls.rolling(20).min()) / 2 + basis) / 2; mom = cs - mid
    release = (~sqz) & sqz.shift(1).fillna(False)
    sQ = np.where(release & (mom > 0), 1, np.where(release & (mom < 0), -1, 0))
    sig = np.column_stack([trendrule(kama), trendrule(fr), trendrule(hma), sT, sV, sQ]); sig[:FIRST] = 0
    return sig
d0 = sys.argv[1] if len(sys.argv) > 1 else "."
allok = True
for f in sorted(glob.glob(os.path.join(d0, "RL_selftest_*.csv"))):
    sym = os.path.basename(f).split("_")[2].split(".")[0]
    d = pd.read_csv(f); n = len(d)
    o, h, l, c = d.open.values, d.high.values, d.low.values, d.close.values
    sig = signals(h, l, c)
    bad = int((sig != d[["s0", "s1", "s2", "s3", "s4", "s5"]].values).sum())
    cs, hs, ls = pd.Series(c), pd.Series(h), pd.Series(l)
    tr = pd.concat([hs - ls, (hs - cs.shift()).abs(), (ls - cs.shift()).abs()], axis=1).max(axis=1)
    a14 = tr.rolling(14).mean(); a100 = tr.rolling(100).mean()
    den = cs.diff().abs().rolling(48).sum(); er = np.where(den > 0, (cs - cs.shift(48)).abs() / den, 0.0)
    lv = np.log(a14 / a100); ema = cs.ewm(span=20, adjust=False).mean(); sl = ((ema - ema.shift(10)).abs() / a14).clip(upper=6)
    rg = ((hs.rolling(24).max() - ls.rolling(24).min()) / a14).clip(upper=30)
    Z = (np.column_stack([er, lv, sl, rg]) - MU) / SD; ZC = (CENT - MU) / SD
    st = np.argmin(((Z[:, None, :] - ZC[None, :, :]) ** 2).sum(2), axis=1); st = np.where(np.arange(n) >= 99, st, -1)
    stbad = int((st != d.state.values).sum()); atr = a14.values
    for tag in ("s0", "s2"):
        ss = pd.read_csv(os.path.join(d0, f"RL_stats_{sym}_{tag}.csv")); cost = float(ss.cost.iloc[0]); stopAtr = float(ss.stop.iloc[0])
        cells = {(r, s): [] for r in range(6) for s in range(5)}; stp = {(r, s): 0 for r in range(6) for s in range(5)}; ntr = 0
        for r in range(6):
            last = -10 ** 9
            for i in range(FIRST, n - HOLD - 1):
                dirn = sig[i, r]
                if dirn == 0 or st[i] < 0 or not (atr[i] > 0) or i - last < HOLD: continue
                last = i; e0 = o[i + 1]; pnl = dirn * (o[i + 1 + HOLD] - e0); hit = False
                if stopAtr > 0:
                    sp = e0 - dirn * stopAtr * atr[i]
                    for j in range(i + 1, i + HOLD + 1):
                        tol = 1e-12 * max(1.0, abs(sp))
                        if (dirn > 0 and l[j] <= sp + tol) or (dirn < 0 and h[j] >= sp - tol): pnl = dirn * (sp - e0); hit = True; break
                cells[(r, st[i])].append((pnl - cost) / atr[i]); stp[(r, st[i])] += int(hit); ntr += 1
        maxd = 0.0; cm = 0
        for _, row in ss.iterrows():
            k = cell(cells[(int(row.rule), int(row.state))])
            if k["n"] != row.n or k["cls"] != row.cls or stp[(int(row.rule), int(row.state))] != row.nStop: cm += 1
            maxd = max(maxd, abs(k["avg"] - row.avg), abs(k["hit"] - row.hit), abs(k["p"] - row.p))
        ok = bad == 0 and stbad == 0 and cm == 0 and maxd < 1e-6
        allok &= ok
        print(sym, tag, "stop", stopAtr, "signal mismatches", bad, "state mismatches", stbad, "trades", ntr, "stopped", sum(stp.values()), "cell n/class/stop mismatches", cm, "max diff avg/hit/p", f"{maxd:.1e}", "OK" if ok else "FAIL")
print("ALL OK" if allok else "SOME FAILED")
