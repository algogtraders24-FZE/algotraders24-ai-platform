"""Independent check of the Setup Pro layer: levels, forward simulation, outcomes in R after cost, and the scorecard (incl. the sign-flip p).
Pullback / squeeze event detection comes from the already verified cores (events are read from the dump); ATR is recomputed here.
Usage: python -I verify_sp.py SP_selftest.csv"""
import csv, sys, math
rows = list(csv.reader(open(sys.argv[1])))
meta = [r for r in rows if r[0] == "meta"][0]; n = int(meta[1]); SLM, RR, HOLD, COST, ATRP = float(meta[2]), float(meta[3]), int(meta[4]), float(meta[5]), int(meta[6])
bars = [tuple(float(x) for x in r[1:5]) for r in rows if r[0] == "bar"]
O = [b[0] for b in bars]; H = [b[1] for b in bars]; L = [b[2] for b in bars]; C = [b[3] for b in bars]
atr = [0.0] * n
for i in range(n):
    tr = H[0] - L[0] if i == 0 else max(H[i] - L[i], abs(H[i] - C[i - 1]), abs(L[i] - C[i - 1]))
    atr[i] = tr if i == 0 else ((atr[i - 1] * i + tr) / (i + 1) if i < ATRP else (atr[i - 1] * (ATRP - 1) + tr) / ATRP)
ev = {0: [], 1: []}
for r in rows:
    if r[0] == "ev": ev[int(r[1])].append((int(r[2]), int(r[3])))
M = 0xFFFFFFFF
def rng(seed):
    s = [seed & M]
    def nx():
        x = s[0]; x ^= (x << 13) & M; x ^= x >> 17; x ^= (x << 5) & M; s[0] = x; return x
    return nx
def maxdd(p):
    return 0.0
def tt(rs, seed):
    m = len(rs); total = sum(rs); mean = total / m; var = (sum(v * v for v in rs) - m * mean * mean) / (m - 1); sd = math.sqrt(max(var, 0)); t = mean / (sd / math.sqrt(m)) if sd > 0 else 0
    nx = rng(seed); cnt = 0
    for _ in range(5000):
        s = 0.0
        for v in rs: s += v if (nx() >> 8) & 1 else -v
        if s >= total - 1e-9: cnt += 1
    return total, mean, t, (1 + cnt) / 5001
def simulate(events):
    out = []; last = -1
    for i, d in events:
        if i < 1 or i + 1 > n - 1 or d == 0 or atr[i] <= 0 or i <= last: continue
        entry = O[i + 1]; risk = SLM * atr[i]; sl = entry - d * risk; tp = entry + d * RR * risk
        res, ex, r = 2, -1, 0.0
        for j in range(i + 1, min(n - 1, i + HOLD) + 1):
            slh = L[j] <= sl if d > 0 else H[j] >= sl; tph = H[j] >= tp if d > 0 else L[j] <= tp
            if slh: res, ex, r = -1, j, -1.0 - COST / risk; break
            if tph: res, ex, r = 1, j, RR - COST / risk; break
            if j == i + HOLD: res, ex, r = 0, j, d * (C[j] - entry) / risk - COST / risk; break
        out.append((i, d, entry, sl, tp, risk, ex, res, r)); last = n if res == 2 else ex
    return out
bad = 0
for ty in (0, 1):
    py = simulate(ev[ty]); ref = [r for r in rows if r[0] == "setup" and int(r[1]) == ty]
    ok = len(py) == len(ref)
    if ok:
        for a, b in zip(py, ref):
            rb = (int(b[2]), int(b[3]), float(b[4]), float(b[5]), float(b[6]), float(b[7]), int(b[8]), int(b[9]), float(b[10]))
            if not (a[0] == rb[0] and a[1] == rb[1] and a[6] == rb[6] and a[7] == rb[7] and all(abs(x - y) < 1e-4 * max(1, abs(x)) for x, y in zip(a[2:6] + (a[8],), rb[2:6] + (rb[8],)))): ok = False; break
    res = [x[8] for x in py if x[7] != 2]; opn = sum(1 for x in py if x[7] == 2)
    sc = [r for r in rows if r[0] == "score" and int(r[1]) == ty][0]
    if len(res) >= 2:
        total, mean, t, p = tt(res, 20261111); wins = sum(1 for v in res if v > 0)
        mine = [len(res), wins, 100.0 * wins / len(res), mean, total, t, p, opn]; theirs = [float(x) for x in sc[2:]]
        sok = all(abs(a - b) < 1e-4 * max(1, abs(a)) for a, b in zip(mine, theirs))
    else: sok = True; mine = [len(res)]
    bad += 0 if ok and sok else 1
    print(f"type {ty}: setups {len(py)} (MT5 {len(ref)}) resolved {len(res)} hit {mine[2] if len(mine) > 2 else 0:.1f}% avgR {mine[3] if len(mine) > 3 else 0:+.3f} t {mine[5] if len(mine) > 5 else 0:.2f} pFlip {mine[6] if len(mine) > 6 else 1:.3f} open {opn}  setups {'identical' if ok else 'DIFF'}, scorecard {'identical' if sok else 'DIFF ' + str(sc[2:])}")
print("RESULT", "PASS" if bad == 0 else "FAIL")
