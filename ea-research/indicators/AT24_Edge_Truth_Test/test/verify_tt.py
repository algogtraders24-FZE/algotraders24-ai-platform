"""Independent check of AT24_TT_Core: same xorshift32 stream, same procedure, written separately.
Usage: python -I verify_tt.py TT_selftest.csv"""
import csv, sys, math
rows = list(csv.reader(open(sys.argv[1])))
trades = {}; ref = {}
for r in rows:
    if r[0] == "trade": trades.setdefault(r[1], []).append(float(r[2]))
    elif r[0] == "res": ref[r[1]] = r[2:]
M = 0xFFFFFFFF; EPS = 1e-9; FLIPS, BOOT, SHUF = 5000, 2000, 2000
def make_rng(seed):
    s = [seed & M]
    def nxt():
        x = s[0]; x ^= (x << 13) & M; x ^= x >> 17; x ^= (x << 5) & M; s[0] = x; return x
    return nxt
def maxdd(p):
    cum = peak = dd = 0.0
    for v in p:
        cum += v; peak = max(peak, cum); dd = max(dd, peak - cum)
    return dd
def run(p, seed):
    n = len(p); wins = sum(1 for v in p if v > 0); total = sum(p); mean = total / n
    var = (sum(v * v for v in p) - n * mean * mean) / (n - 1); sd = math.sqrt(max(var, 0)); t = mean / (sd / math.sqrt(n)) if sd > 0 else 0
    gw = sum(v for v in p if v > 0); gl = -sum(v for v in p if v <= 0); pf = gw / gl if gl > 0 else 0
    nx = make_rng(seed); cnt = 0
    for _ in range(FLIPS):
        s = 0.0
        for v in p: s += v if (nx() >> 8) & 1 else -v
        if s >= total - EPS: cnt += 1
    pflip = (1 + cnt) / (FLIPS + 1)
    bt = []; le0 = 0
    for _ in range(BOOT):
        s = 0.0
        for _i in range(n): s += p[nx() % n]
        bt.append(s); le0 += s <= EPS
    sb = sorted(bt); lo, hi = sb[int(0.05 * BOOT)], sb[int(0.95 * BOOT)]
    dd = maxdd(p); q = list(p); dds = []; smaller = 0
    for _ in range(SHUF):
        for i in range(n - 1, 0, -1):
            j = nx() % (i + 1); q[i], q[j] = q[j], q[i]
        d = maxdd(q); dds.append(d); smaller += d < dd - EPS
    sd2 = sorted(dds); med = 0.5 * (sd2[SHUF // 2 - 1] + sd2[SHUF // 2])
    return [n, wins, total, mean, sd, t, pf, pflip, lo, hi, le0 / BOOT, dd, med, smaller / SHUF]
bad = 0
for name, p in trades.items():
    py = run(p, 20261111); rf = [float(x) for x in ref[name]]
    ok = all(abs(a - b) < 1e-4 * max(1, abs(a)) for a, b in zip(py, rf))
    bad += 0 if ok else 1
    print(f"{name:7s} n {py[0]:3d} total {py[2]:9.1f} t {py[5]:6.2f} pFlip {py[7]:.4f} boot [{py[8]:.0f}, {py[9]:.0f}] pLoss {py[10]:.3f} dd {py[11]:.0f} ddMed {py[12]:.0f} ddRank {py[13]:.2f}  {'ok' if ok else 'DIFF ' + str(rf)}")
print("RESULT", "PASS" if bad == 0 else "FAIL")
