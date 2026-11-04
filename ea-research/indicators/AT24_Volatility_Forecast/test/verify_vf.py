"""Independent check of AT24_VF_Core: four OHLC volatility estimators, EWMA forecasts, ATR and naive baselines, and the
calibration study (correlation, bias, within +-30 %). Usage: python -I verify_vf.py VF_selftest.csv"""
import csv, sys, math, statistics

rows = list(csv.reader(open(sys.argv[1])))
meta = [r for r in rows if r[0] == "meta"][0]
n, H, warm, start, lam = int(meta[1]), int(meta[2]), int(meta[3]), int(meta[4]), float(meta[5])
tms = [int(r[1]) for r in rows if r[0] == "bar"]
bars = [tuple(float(x) for x in r[2:6]) for r in rows if r[0] == "bar"]
mt = {r[1]: [float(x) for x in r[2:]] for r in rows if r[0] == "calib"}
last = [float(x) for x in [r for r in rows if r[0] == "last"][0][1:]]
O = [b[0] for b in bars]; Hh = [b[1] for b in bars]; L = [b[2] for b in bars]; C = [b[3] for b in bars]
ln = math.log
k2, p = 2 * ln(2) - 1, 1 / (4 * ln(2))
v = [[0.0] * n for _ in range(4)]
for i in range(n):
    hl, co = ln(Hh[i] / L[i]), ln(C[i] / O[i])
    v[1][i] = p * hl * hl
    v[2][i] = 0.5 * hl * hl - k2 * co * co
    v[3][i] = ln(Hh[i] / C[i]) * ln(Hh[i] / O[i]) + ln(L[i] / C[i]) * ln(L[i] / O[i])
    v[0][i] = 0.0 if i == 0 else ln(C[i] / C[i - 1]) ** 2

def ewma(var):
    sig = [0.0] * n
    s2 = sum(max(var[i], 0) for i in range(1, warm + 1)) / warm
    sig[warm] = math.sqrt(s2)
    for i in range(warm + 1, n):
        s2 = lam * s2 + (1 - lam) * max(var[i], 0)
        sig[i] = math.sqrt(s2)
    return sig

sig = [ewma(v[k]) for k in range(4)]
atr = [0.0] * n; a = 0.0; sm = 0.0
for i in range(n):
    tr = Hh[i] - L[i] if i == 0 else max(Hh[i] - L[i], abs(Hh[i] - C[i - 1]), abs(L[i] - C[i - 1]))
    if i < 14:
        sm += tr
        if i == 13: a = sm / 14; atr[i] = a / C[i]
    else:
        a = (a * 13 + tr) / 14; atr[i] = a / C[i]
naive = [0.0] * n
for i in range(H, n): naive[i] = math.sqrt(sum(v[0][j] for j in range(i - H + 1, i + 1)) / H)

def calib(f):
    lf, lr, ratio, ok30 = [], [], [], 0
    t = start
    while t + H < n:
        if f[t] > 0:
            real = math.sqrt(sum(v[0][j] for j in range(t + 1, t + H + 1)) / H)
            if real > 0:
                lf.append(ln(f[t])); lr.append(ln(real)); ratio.append(real / f[t])
                if abs(real / f[t] - 1) <= 0.30: ok30 += 1
        t += H
    m = len(lf)
    mf, mr = sum(lf) / m, sum(lr) / m
    sxy = sum((a - mf) * (b - mr) for a, b in zip(lf, lr)); sxx = sum((a - mf) ** 2 for a in lf); syy = sum((b - mr) ** 2 for b in lr)
    return [m, sxy / math.sqrt(sxx * syy), statistics.median(ratio), 100 * ok30 / m]

S = 96
slot = [(t % 86400) // 900 for t in tms]
def seasonal(var):
    fH = [0.0] * n; lv = [0.0] * n
    sm = [0.0] * S; ct = [0] * S; tot = 0.0; totc = 0; level = 0.0
    for i in range(1, n):
        vi = max(var[i], 0.0)
        mean = tot / totc if totc else 0.0
        f = 1.0
        if ct[slot[i]] >= 3 and mean > 0: f = (sm[slot[i]] / ct[slot[i]]) / mean
        if f <= 1e-9: f = 1.0
        d = vi / f
        if i <= warm:
            level += d
            if i == warm: level /= warm
        else: level = lam * level + (1 - lam) * d
        sm[slot[i]] += vi; ct[slot[i]] += 1; tot += vi; totc += 1
        if i >= warm and tot > 0: lv[i] = math.sqrt(max(level, 0.0) / (tot / totc))
        if i >= warm:
            m2 = tot / totc; acc = 0.0
            for j in range(1, H + 1):
                sl = (slot[i] + j) % S
                fj = 1.0
                if ct[sl] >= 3 and m2 > 0: fj = (sm[sl] / ct[sl]) / m2
                if fj <= 1e-9: fj = 1.0
                acc += fj
            fH[i] = math.sqrt(max(level, 0.0) * acc / H)
    return fH, lv
names = ["cc_ewma", "parkinson_ewma", "gk_ewma", "rs_ewma", "atr14", "naive_prev_H", "cc_seasonal", "rs_seasonal"]
(sc_f, lc_f), (sr_f, lr_f) = seasonal(v[0]), seasonal(v[3])
fs = sig + [atr, naive, sc_f, sr_f]
ok_all = True
for nm, f in zip(names, fs):
    py = calib(f); ref = mt[nm]
    ok = abs(py[0] - ref[0]) < 1e-9 and all(abs(a - b) < 1e-5 for a, b in zip(py[1:], ref[1:]))
    ok_all &= ok
    print(f"{nm:15s} n={py[0]:3d} corr py {py[1]:.4f} mt5 {ref[1]:.4f} | bias {py[2]:.4f}/{ref[2]:.4f} | within30 {py[3]:.1f}/{ref[3]:.1f}  {'ok' if ok else 'DIFF'}")
ok_last = all(abs(a - b) < 1e-8 for a, b in zip([s[-1] for s in sig] + [atr[-1], naive[-1]], last[:6])) and abs(sc_f[-1] - last[7]) < 1e-8 and abs(sr_f[-1] - last[8]) < 1e-8 and abs(lr_f[-1] - last[9]) < 1e-8
cnt = sum(1 for i in range(max(0, n - 2000), n) if sig[3][i] > 0); below = sum(1 for i in range(max(0, n - 2000), n) if 0 < sig[3][i] < sig[3][-1])
pct = 100 * below / cnt
ok_last &= abs(pct - last[6]) < 1e-4
cnt2 = sum(1 for i in range(max(0, n - 2000), n) if lr_f[i] > 0); below2 = sum(1 for i in range(max(0, n - 2000), n) if 0 < lr_f[i] < lr_f[-1])
pct2 = 100 * below2 / cnt2
ok_last &= abs(pct2 - last[10]) < 1e-4
print(f"seasonal level vs usual {lr_f[-1]:.3f}x, percentile py {pct2:.2f} mt5 {last[10]:.2f}")
print("last values + percentile", "ok" if ok_last else "DIFF", f"(pct py {pct:.2f} mt5 {last[6]:.2f})")
print("RESULT", "PASS" if ok_all and ok_last else "FAIL")
