"""Independent check of the expected-range core: recompute the features, the target, the hour pattern, the ridge fit, the residual quantiles,
the out-of-sample coverage and the final range with numpy from the OHLC columns of the MQL5 dump and compare.
Usage: python verify_rr.py <dir with RR_selftest_*.csv and RR_out_*.csv>"""
import sys, glob, os, numpy as np, pandas as pd
FIRST, FWD, LAM, MINTR = 150, 24, 1.0, 1500
d0 = sys.argv[1] if len(sys.argv) > 1 else "."
def series(h, l, c):
    n = len(h); tr = np.empty(n); tr[0] = h[0] - l[0]
    for i in range(1, n): tr[i] = max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1]))
    cs = np.concatenate([[0], np.cumsum(tr)])
    def avg(i, w): return (cs[i + 1] - cs[i + 1 - w]) / w
    f = np.zeros((n, 3)); ok = np.zeros(n, bool); y = np.zeros(n); yok = np.zeros(n, bool)
    for i in range(FIRST, n):
        a14, a24, a120 = avg(i, 14), avg(i, 24), avg(i, 120)
        if a14 <= 0 or a24 <= 0 or a120 <= 0 or c[i] <= 0: continue
        f[i] = np.log([a14 / c[i], a24 / c[i], a120 / c[i]]); ok[i] = True
        if i + FWD <= n - 1:
            fr = (h[i + 1:i + FWD + 1].max() - l[i + 1:i + FWD + 1].min()) / c[i]
            if fr > 0: y[i] = np.log(fr); yok[i] = True
    return f, ok, y, yok
def fit(a, b, hr, f, ok, y, yok):
    rows = [i for i in range(a, b + 1) if ok[i] and yok[i]]
    if len(rows) < MINTR: return None
    rows = np.array(rows); ym = y[rows].mean()
    sea = np.array([y[rows][hr[rows] == k].mean() if (hr[rows] == k).any() else ym for k in range(24)])
    X = np.column_stack([f[rows], sea[hr[rows]]])
    m = X.mean(0); s = X.std(0) + 1e-12
    Z = (X - m) / s
    w = np.linalg.solve(Z.T @ Z + LAM * np.eye(4), Z.T @ (y[rows] - ym))
    res = y[rows] - (Z @ w + ym)
    q = np.quantile(res, [0.1, 0.5, 0.9])
    return dict(sea=sea, ym=ym, m=m, s=s, w=w, q=q, n=len(rows))
def pred(M, i, hr, f):
    x = np.array([f[i, 0], f[i, 1], f[i, 2], M["sea"][hr[i]]])
    return float(((x - M["m"]) / M["s"]) @ M["w"] + M["ym"])
allok = True
for fpath in sorted(glob.glob(os.path.join(d0, "RR_selftest_*.csv"))):
    sym = os.path.basename(fpath).split("_")[2].split(".")[0]
    d = pd.read_csv(fpath); n = len(d)
    h, l, c = d.high.values, d.low.values, d.close.values; hr = ((d.t.values % 86400) // 3600).astype(int)
    f, ok, y, yok = series(h, l, c)
    e = {"ok": int((ok != d.ok.astype(bool).values).sum()), "yok": int((yok != d.yok.astype(bool).values).sum())}
    m = ok
    e["la14"] = float(np.abs(f[m, 0] - d.la14.values[m]).max()); e["la24"] = float(np.abs(f[m, 1] - d.la24.values[m]).max()); e["la120"] = float(np.abs(f[m, 2] - d.la120.values[m]).max())
    mm = yok; e["y"] = float(np.abs(y[mm] - d.y.values[mm]).max())
    a, b = FIRST, n - 1 - FWD
    fin = fit(a, b, hr, f, ok, y, yok)
    s = a + int(0.7 * (b - a))
    trn = fit(a, s - 48, hr, f, ok, y, yok)
    inn = tot = 0
    for i in range(s, b + 1):
        if not (ok[i] and yok[i]): continue
        p = pred(trn, i, hr, f); tot += 1; inn += int(trn["q"][0] - 1e-12 + p <= y[i] <= p + trn["q"][2] + 1e-12)
    last = n - 1; p = pred(fin, last, hr, f); px = c[last]
    O = pd.read_csv(os.path.join(d0, f"RR_out_{sym}.csv")).iloc[0]
    diffs = {"pred": abs(p - O.pred), "q10": abs(fin["q"][0] - O.q10), "q50": abs(fin["q"][1] - O.q50), "q90": abs(fin["q"][2] - O.q90),
             "mid": abs(px * np.exp(p + fin["q"][1]) - O.mid), "lo": abs(px * np.exp(p + fin["q"][0]) - O.lo), "hi": abs(px * np.exp(p + fin["q"][2]) - O.hi), "cover": abs(inn / tot - O.cover)}
    cnt = (tot == O.nCover) and (fin["n"] == O.nTrain)
    good = e["ok"] == 0 and e["yok"] == 0 and max(e["la14"], e["la24"], e["la120"], e["y"]) < 1e-9 and max(diffs.values()) < 1e-6 and cnt
    allok &= good
    print(sym, n, "flags", e["ok"], e["yok"], "feature maxdiff", f"{max(e['la14'], e['la24'], e['la120'], e['y']):.1e}", "out maxdiff", f"{max(diffs.values()):.1e}", "counts", "same" if cnt else "DIFFER",
          f"range {O.mid:.5f} band {O.lo:.5f}-{O.hi:.5f} held {O.cover*100:.1f}%", "OK" if good else "FAIL")
print("ALL OK" if allok else "SOME FAILED")
