"""Independent check of the Analog Finder core: recompute the features, the outcome, the scaling, the analog search (greedy by distance with a
24-bar separation), the statistics and the self-test (incl. the xorshift32 luck test) with numpy from the OHLC columns of the MQL5 dump and compare.
Usage: python verify_af.py <dir with AF_selftest_*.csv, AF_feat_*.csv and AF_out_*.csv>"""
import sys, glob, os, numpy as np, pandas as pd
FIRST, FWD, K, SEP, FLIPS, SEED, MINN = 250, 24, 30, 24, 3000, 20261118, 30
M32 = 0xFFFFFFFF
def xs(x):
    x ^= (x << 13) & M32; x ^= x >> 17; x ^= (x << 5) & M32
    return x & M32
def luck(rv):
    m = len(rv)
    if m == 0: return dict(n=0, avg=0.0, hit=0.0, p=1.0, cls=2)
    avg = float(np.mean(rv)); hit = float(np.mean(np.array(rv) > 0))
    if m < MINN: return dict(n=m, avg=avg, hit=hit, p=1.0, cls=2)
    x = SEED; ge = 0
    for _ in range(FLIPS):
        fs = 0.0
        for v in rv:
            x = xs(x); fs += v if (x & 1) == 1 else -v
        if fs / m >= avg - 1e-12: ge += 1
    p = ge / FLIPS
    return dict(n=m, avg=avg, hit=hit, p=p, cls=1 if (avg > 0 and p < 0.10) else (-1 if avg < 0 else 0))
def features(h, l, c):
    n = len(c); hs, ls, cs = pd.Series(h), pd.Series(l), pd.Series(c)
    tr = pd.concat([hs - ls, (hs - cs.shift()).abs(), (ls - cs.shift()).abs()], axis=1).max(axis=1)
    a14 = tr.rolling(14).mean().values; a100 = tr.rolling(100).mean().values
    f = np.zeros((n, 12)); ok = np.zeros(n, bool); y = np.zeros(n); yok = np.zeros(n, bool)
    dl = cs.diff(); up = dl.clip(lower=0).rolling(14).mean().values; dn = (-dl.clip(upper=0)).rolling(14).mean().values
    rsi = 100 - 100 / (1 + up / (dn + 1e-12))
    e = {s: cs.ewm(span=s, adjust=False).mean().values for s in (20, 50, 200)}
    hmax = hs.rolling(48).max().values; lmin = ls.rolling(48).min().values
    for i in range(FIRST, n):
        if not (a14[i] > 0 and a100[i] > 0): continue
        for q, g in enumerate((1, 3, 6, 12, 24, 48)): f[i, q] = (c[i] - c[i - g]) / a14[i]
        f[i, 6] = np.log(a14[i] / a100[i]); f[i, 7] = (rsi[i] - 50) / 25
        for q, s in enumerate((20, 50, 200)): f[i, 8 + q] = (c[i] - e[s][i]) / a14[i]
        f[i, 11] = (c[i] - lmin[i]) / (hmax[i] - lmin[i] + 1e-12)
        ok[i] = True
        if i + FWD <= n - 1: y[i] = (c[i + FWD] - c[i]) / a14[i]; yok[i] = True
    return f, ok, y, yok
def search(q, last, f, ok, yok, y, mu, sd):
    z = (f - mu) / sd; zq = z[q]
    rows = np.array([i for i in range(FIRST, last + 1) if ok[i] and yok[i]])
    d = ((z[rows] - zq) ** 2).sum(1)
    order = np.argsort(d, kind="stable"); sel = []; dd = []
    for o in order:
        i = rows[o]
        if all(abs(i - s) >= SEP for s in sel):
            sel.append(int(i)); dd.append(np.sqrt(d[o]))
            if len(sel) == K: break
    v = np.sort(y[sel])
    return dict(idx=sel, mean=float(np.mean(v)), q=np.quantile(v, [0.1, 0.25, 0.5, 0.75, 0.9]), up=float(np.mean(v > 0)), md=float(np.mean(dd)), v=v)
d0 = sys.argv[1] if len(sys.argv) > 1 else "."
allok = True
for fp in sorted(glob.glob(os.path.join(d0, "AF_selftest_*.csv"))):
    sym = os.path.basename(fp).split("_")[2].split(".")[0]
    b = pd.read_csv(fp); h, l, c = b.high.values, b.low.values, b.close.values; n = len(c)
    f, ok, y, yok = features(h, l, c)
    ft = pd.read_csv(os.path.join(d0, f"AF_feat_{sym}.csv"))
    fd = 0.0; flag = 0
    for _, r in ft.iterrows():
        i = int(r.i); flag += int(bool(r.ok) != ok[i]) + int(bool(r.yok) != yok[i])
        fd = max(fd, abs(r.y - y[i]), *[abs(r[f"f{q}"] - f[i, q]) for q in range(12)])
    # scaling
    s_end = FIRST + int(np.floor(0.6 * (n - 1 - FWD - FIRST)))
    rr = [i for i in range(FIRST, s_end + 1) if ok[i] and yok[i]]
    mu = f[rr].mean(0); sd = f[rr].std(0) + 1e-12
    st = search(n - 1, n - 1 - FWD, f, ok, yok, y, mu, sd)
    held = 0; nt = 0; rv = []; sumall = 0.0
    j = s_end + 1
    while j <= n - 1 - FWD:
        if ok[j] and yok[j]:
            s = search(j, j - FWD, f, ok, yok, y, mu, sd)
            if len(s["idx"]) >= 10:
                nt += 1; sumall += y[j]; held += int(s["q"][0] - 1e-12 <= y[j] <= s["q"][4] + 1e-12)
                if s["up"] >= 0.6 or s["up"] <= 0.4: rv.append((1.0 if s["up"] >= 0.5 else -1.0) * y[j])
        j += FWD
    lk = luck(rv)
    O = pd.read_csv(os.path.join(d0, f"AF_out_{sym}.csv")).iloc[0]
    diffs = [abs(st["mean"] - O["mean"]), abs(st["q"][0] - O.q10), abs(st["q"][1] - O.q25), abs(st["q"][2] - O.q50), abs(st["q"][3] - O.q75), abs(st["q"][4] - O.q90),
             abs(st["up"] - O.shareUp), abs(st["md"] - O.meanDist), abs(held / nt - O.bandHeld), abs(lk["hit"] - O.hit), abs(lk["avg"] - O.avgR), abs(lk["p"] - O.p), abs(sumall / nt - O.alwaysLong)]
    ids_same = [int(x) for x in str(O.idx).split()] == st["idx"]
    cnt_same = (O.k == len(st["idx"])) and (O.nTest == nt) and (O.nSel == len(rv)) and (O.cls == lk["cls"]) and (O.sEnd == s_end)
    good = flag == 0 and fd < 1e-9 and max(diffs) < 1e-8 and ids_same and cnt_same
    allok &= good
    print(sym, n, "flags", flag, "feature maxdiff", f"{fd:.1e}", "analog ids", "same" if ids_same else "DIFFER", "stats maxdiff", f"{max(diffs):.1e}", "counts", "same" if cnt_same else "DIFFER",
          f"| {len(st['idx'])} analogs, median {st['q'][2]:.3f} ATR, up {st['up']*100:.0f}%, self-test {nt} pts, band held {held/nt*100:.1f}%, hit {lk['hit']*100:.1f}% n {len(rv)} p {lk['p']:.3f}", "OK" if good else "FAIL")
print("ALL OK" if allok else "SOME FAILED")
