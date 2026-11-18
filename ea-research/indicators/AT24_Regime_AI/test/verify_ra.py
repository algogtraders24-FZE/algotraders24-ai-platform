"""Independent check of the Regime AI core: recompute features, states, forward range and statistics with pandas/numpy
from the OHLC columns of the MQL5 dump and compare. Usage: python verify_ra.py <dir with RA_selftest_*.csv>"""
import sys, glob, os, numpy as np, pandas as pd
MU = np.array([0.163863, -0.031967, 1.014311, 5.525808]); SD = np.array([0.119898, 0.26684, 0.766584, 1.932356])
CENT = np.array([[0.1023, 0.1663, 0.6141, 4.3468], [0.1219, -0.2405, 1.3098, 7.4327], [0.3395, -0.1325, 2.6010, 9.4282], [0.1197, -0.2249, 0.4958, 4.6743], [0.2955, 0.1396, 1.5741, 5.6380]])
d0 = sys.argv[1] if len(sys.argv) > 1 else "."
allok = True
for f in sorted(glob.glob(os.path.join(d0, "RA_selftest_*.csv"))):
    sym = os.path.basename(f).split("_")[2].split(".")[0]
    d = pd.read_csv(f); n = len(d)
    h, l, c = d.high, d.low, d.close
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    atr14 = tr.rolling(14).mean(); atr100 = tr.rolling(100).mean()
    er = (c - c.shift(48)).abs() / c.diff().abs().rolling(48).sum()
    lvol = np.log(atr14 / atr100)
    ema = c.ewm(span=20, adjust=False).mean()
    slope = ((ema - ema.shift(10)).abs() / atr14).clip(upper=6)
    rngx = ((h.rolling(24).max() - l.rolling(24).min()) / atr14).clip(upper=30)
    valid = np.zeros(n, bool); valid[99:] = True
    Z = (np.column_stack([er, lvol, slope, rngx]) - MU) / SD; ZC = (CENT - MU) / SD
    dist = ((Z[:, None, :] - ZC[None, :, :]) ** 2).sum(2)
    state = np.where(valid, np.argmin(dist, axis=1), -1)
    fr = np.full(n, -1.0)
    hv, lv = h.values, l.values
    for i in range(99, n - 24):
        fr[i] = (hv[i + 1:i + 25].max() - lv[i + 1:i + 25].min()) / atr14.iloc[i]
    m = valid
    def mx(a, b): return float(np.nanmax(np.abs(np.asarray(a)[m] - np.asarray(b)[m])))
    e = {"atr14": mx(atr14, d.atr14), "er": mx(er, d.er), "lvol": mx(lvol, d.lvol), "slope": mx(slope, d.slope), "rngx": mx(rngx, d.rngx), "fr": mx(np.where(fr >= 0, fr, 0), np.where(d.fr >= 0, d.fr, 0))}
    mism = int((state != d.state.values).sum())
    # a state mismatch is only acceptable when the two best distances are within 1e-9 (rounding of the dump)
    near = 0
    for i in np.where(state != d.state.values)[0]:
        sd_ = np.sort(dist[i]); near += int(sd_[1] - sd_[0] < 1e-6)
    # statistics
    st = state; frs = fr
    tot = (st >= 0).sum()
    ss = pd.read_csv(os.path.join(d0, f"RA_stats_{sym}.csv"))
    allk = frs >= 0; allfwd = frs[allk].mean()
    se = 0.0
    for k in range(5):
        idx = np.where(st == k)[0]
        nk = len(idx); nf = int((frs[idx] >= 0).sum())
        share = nk / tot
        # runs over valid bars
        runs = 0; rl = 0; prev = None
        for i in range(99, n):
            if st[i] == k:
                rl += 1
                if i == 99 or st[i - 1] != k: runs += 1
        meanrun = rl / runs if runs else 0
        trans = stay = 0
        for i in range(99, n - 1):
            if st[i] == k and st[i + 1] >= 0:
                trans += 1; stay += int(st[i + 1] == k)
        pst = stay / trans if trans else 0
        ratio = (frs[idx][frs[idx] >= 0].mean() / allfwd) if nf >= 200 else 0.0
        row = ss[ss.state == k].iloc[0]
        se = max(se, abs(share - row.share), abs(meanrun - row.meanRun), abs(pst - row.pStay), abs(ratio - row.ratio), abs(allfwd - row.allFwd))
        if nk != row.n or nf != row.nf: se = max(se, 1)
    ok = max(e.values()) < 1e-6 and (mism == near) and se < 1e-6
    allok &= ok
    print(sym, n, "maxdiff", {k: f"{v:.1e}" for k, v in e.items()}, "state mismatches", mism, "(near-tie", near, ") stats maxdiff", f"{se:.1e}", "OK" if ok else "FAIL")
print("ALL OK" if allok else "SOME FAILED")
