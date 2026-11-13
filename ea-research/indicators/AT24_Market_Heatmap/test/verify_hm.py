"""Independent check of AT24_HM_Core: every heatmap field recomputed in Python from the daily bars.
Usage: python -I verify_hm.py HM_selftest_0.csv [HM_selftest_1.csv ...]"""
import csv, sys
def check(path):
    rows = list(csv.reader(open(path)))
    bars = [tuple(float(x) for x in r[1:5]) for r in rows if r[0] == "bar"]
    ref = [r for r in rows if r[0] == "row"][0]
    O = [b[0] for b in bars]; H = [b[1] for b in bars]; L = [b[2] for b in bars]; C = [b[3] for b in bars]; n = len(bars)
    def ema(p):
        a = 2.0 / (p + 1); out = [C[0]]
        for i in range(1, n): out.append(a * C[i] + (1 - a) * out[-1])
        return out
    e50, e200 = ema(50), ema(200)
    atr = [0.0] * n
    for i in range(n):
        tr = H[0] - L[0] if i == 0 else max(H[i] - L[i], abs(H[i] - C[i - 1]), abs(L[i] - C[i - 1]))
        atr[i] = tr if i == 0 else ((atr[i - 1] * i + tr) / (i + 1) if i < 14 else (atr[i - 1] * 13 + tr) / 14)
    ag = al = 0.0; rsi = 50.0
    for i in range(1, n):
        ch = C[i] - C[i - 1]; g = max(ch, 0.0); l = max(-ch, 0.0)
        if i <= 14:
            ag += g; al += l
            if i == 14: ag /= 14; al /= 14; rsi = 100.0 if al == 0 else 100.0 - 100.0 / (1 + ag / al)
        else:
            ag = (ag * 13 + g) / 14; al = (al * 13 + l) / 14; rsi = 100.0 if al == 0 else 100.0 - 100.0 / (1 + ag / al)
    i = n - 1
    hh = max(H[i - 251:i + 1]); ll = min(L[i - 251:i + 1])
    py = [1, C[i], 100 * (C[i] / C[i - 1] - 1), 100 * (C[i] / C[i - 5] - 1), 100 * (C[i] / C[i - 21] - 1), 100 * atr[i] / C[i], (C[i] - C[i - 1]) / atr[i - 1],
          (1 if C[i] > e50[i] > e200[i] else (-1 if C[i] < e50[i] < e200[i] else 0)), rsi, 100 * (C[i] - ll) / (hh - ll), 100 * (C[i] / hh - 1)]
    mt = [float(x) for x in ref[1:]]
    ok = all(abs(a - b) < 1e-4 * max(1, abs(a)) for a, b in zip(py, mt))
    print(f"{path}: bars {n} last {py[1]:.2f} 1d {py[2]:+.2f}% 5d {py[3]:+.2f}% 21d {py[4]:+.2f}% ATR {py[5]:.2f}% move {py[6]:+.2f} ATR trend {py[7]:+d} RSI {py[8]:.1f} range {py[9]:.0f}% fromHigh {py[10]:.1f}%  -> {'identical to MT5' if ok else 'DIFF ' + str(mt)}")
    return ok
res = [check(p) for p in sys.argv[1:]]
print("RESULT", "PASS" if all(res) else "FAIL")
