"""Independent check of the whole Zone Pro chain: zone detection, first touches, trades (levels, forward walk, outcome in R after cost) and scorecards.
Everything is recomputed here from the bars alone (ATR included).
Usage: python -I verify_ab.py AB_selftest.csv"""
import csv, sys, math
rows = list(csv.reader(open(sys.argv[1])))
m = [r for r in rows if r[0] == "meta"][0]
n = int(m[1]); VOLK, VOLN, MAXRANGE, LOOK, MOVEATR, SLBUF, RR, HOLD, MAXAGE, COST = float(m[2]), int(m[3]), float(m[4]), int(m[5]), float(m[6]), float(m[7]), float(m[8]), int(m[9]), int(m[10]), float(m[11])
bars = [tuple(float(x) for x in r[1:6]) for r in rows if r[0] == "bar"]
O = [b[0] for b in bars]; H = [b[1] for b in bars]; L = [b[2] for b in bars]; C = [b[3] for b in bars]; TV = [b[4] for b in bars]
atr = [0.0] * n
for i in range(n):
    tr = H[0] - L[0] if i == 0 else max(H[i] - L[i], abs(H[i] - C[i - 1]), abs(L[i] - C[i - 1]))
    atr[i] = tr if i == 0 else ((atr[i - 1] * i + tr) / (i + 1) if i < 14 else (atr[i - 1] * 13 + tr) / 14)
zones = []
for i in range(max(VOLN, LOOK + 1) + 1, n):
    a = atr[i - 1]
    if a <= 0: continue
    avg = sum(TV[i - VOLN:i]) / VOLN
    if avg <= 0 or TV[i] < VOLK * avg: continue
    if H[i] - L[i] > MAXRANGE * a or H[i] - L[i] <= 0: continue
    move = C[i - 1] - C[i - 1 - LOOK]
    d = 1 if move <= -MOVEATR * a else (-1 if move >= MOVEATR * a else 0)
    if d == 0: continue
    zones.append([i, d, H[i], L[i], a, -1])
for z in zones:
    last = min(n - 1, z[0] + MAXAGE)
    for k in range(z[0] + 1, last + 1):
        if (z[1] > 0 and L[k] <= z[2]) or (z[1] < 0 and H[k] >= z[3]): z[5] = k; break
ref_z = [(int(r[1]), int(r[2]), float(r[3]), float(r[4]), float(r[5]), int(r[6])) for r in rows if r[0] == "zone"]
zok = len(ref_z) == len(zones) and all(a[0] == b[0] and a[1] == b[1] and abs(a[2] - b[2]) < 1e-3 and abs(a[3] - b[3]) < 1e-3 and abs(a[4] - b[4]) < 1e-4 * max(1, a[4]) and a[5] == b[5] for a, b in zip(zones, ref_z))
M = 0xFFFFFFFF
def rng(seed):
    s = [seed & M]
    def nx():
        x = s[0]; x ^= (x << 13) & M; x ^= x >> 17; x ^= (x << 5) & M; s[0] = x; return x
    return nx
def tt(rs, seed):
    mm = len(rs); total = sum(rs); mean = total / mm; var = (sum(v * v for v in rs) - mm * mean * mean) / (mm - 1); sd = math.sqrt(max(var, 0)); t = mean / (sd / math.sqrt(mm)) if sd > 0 else 0
    nx = rng(seed); cnt = 0
    for _ in range(5000):
        s = 0.0
        for v in rs: s += v if (nx() >> 8) & 1 else -v
        if s >= total - 1e-9: cnt += 1
    return total, mean, t, (1 + cnt) / 5001
def trades(filt):
    cand = sorted([(z[5], i, z) for i, z in enumerate(zones) if z[5] >= 0 and (filt == 0 or z[1] == filt)], key=lambda x: (x[0], x[1]))
    out = []; last = -1
    for _, _, z in cand:
        k, d = z[5], z[1]
        if k <= last: continue
        entry = min(O[k], z[2]) if d > 0 else max(O[k], z[3])
        sl = z[3] - SLBUF * z[4] if d > 0 else z[2] + SLBUF * z[4]
        risk = d * (entry - sl)
        if risk <= 0: continue
        tp = entry + d * RR * risk; res, ex, r = 2, -1, 0.0
        for j in range(k, min(n - 1, k + HOLD) + 1):
            slh = L[j] <= sl if d > 0 else H[j] >= sl; tph = H[j] >= tp if d > 0 else L[j] <= tp
            if slh: res, ex, r = -1, j, -1.0 - COST / risk; break
            if tph: res, ex, r = 1, j, RR - COST / risk; break
            if j == k + HOLD: res, ex, r = 0, j, d * (C[j] - entry) / risk - COST / risk; break
        out.append((k, d, entry, sl, tp, risk, ex, res, r)); last = n if res == 2 else ex
    return out
bad = 0 if zok else 1
print(f"zones: {len(zones)} (MT5 {len(ref_z)}) touched {sum(1 for z in zones if z[5] >= 0)}  -> {'identical' if zok else 'DIFF'}")
for filt in (0, 1, -1):
    py = trades(filt); ref = [r for r in rows if r[0] == "trade" and int(r[1]) == filt]
    ok = len(py) == len(ref)
    if ok:
        for a, b in zip(py, ref):
            rb = (int(b[2]), int(b[3]), float(b[4]), float(b[5]), float(b[6]), float(b[7]), int(b[8]), int(b[9]), float(b[10]))
            if not (a[0] == rb[0] and a[1] == rb[1] and a[6] == rb[6] and a[7] == rb[7] and all(abs(x - y) < 1e-4 * max(1, abs(x)) for x, y in zip(a[2:6] + (a[8],), rb[2:6] + (rb[8],)))): ok = False; break
    rs = [x[8] for x in py if x[7] != 2]; opn = sum(1 for x in py if x[7] == 2)
    sc = [r for r in rows if r[0] == "score" and int(r[1]) == filt][0]; sok = True; txt = ""
    if len(rs) >= 2:
        total, mean, t, p = tt(rs, 20261111); wins = sum(1 for v in rs if v > 0)
        mine = [len(rs), wins, 100.0 * wins / len(rs), mean, total, t, p, opn]; theirs = [float(x) for x in sc[2:]]
        sok = all(abs(a - b) < 1e-4 * max(1, abs(a)) for a, b in zip(mine, theirs)); txt = f"hit {mine[2]:.1f}% avgR {mine[3]:+.3f} t {mine[5]:.2f} pFlip {mine[6]:.3f}"
    bad += 0 if ok and sok else 1
    print(f"filter {filt:+d}: trades {len(py)} (MT5 {len(ref)}) resolved {len(rs)} {txt} open {opn}  trades {'identical' if ok else 'DIFF'}, score {'identical' if sok else 'DIFF ' + str(sc[2:])}")
print("RESULT", "PASS" if bad == 0 else "FAIL")
