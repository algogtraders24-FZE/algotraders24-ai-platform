"""Independent check of the whole Divergence Pro chain: Wilder RSI, confirmed swing points, divergence events, trades (levels, forward walk, R after cost)
and scorecards. Everything is recomputed here from the bars alone (ATR included).
Usage: python -I verify_dv.py DV_selftest.csv"""
import csv, sys, math
rows = list(csv.reader(open(sys.argv[1])))
m = [r for r in rows if r[0] == "meta"][0]
n = int(m[1]); K, MINSEP, MAXSEP = int(m[2]), int(m[3]), int(m[4]); MINDIFF, SLBUF, MAXRISK, RR, HOLD, COST = float(m[5]), float(m[6]), float(m[7]), float(m[8]), int(m[9]), float(m[10])
bars = [tuple(float(x) for x in r[1:5]) for r in rows if r[0] == "bar"]
O = [b[0] for b in bars]; H = [b[1] for b in bars]; L = [b[2] for b in bars]; C = [b[3] for b in bars]
atr = [0.0] * n
for i in range(n):
    tr = H[0] - L[0] if i == 0 else max(H[i] - L[i], abs(H[i] - C[i - 1]), abs(L[i] - C[i - 1]))
    atr[i] = tr if i == 0 else ((atr[i - 1] * i + tr) / (i + 1) if i < 14 else (atr[i - 1] * 13 + tr) / 14)
rsi = [50.0] * n; ag = al = 0.0
for i in range(1, n):
    ch = C[i] - C[i - 1]; g = max(ch, 0.0); l = max(-ch, 0.0)
    if i <= 14:
        ag += g; al += l
        if i == 14: ag /= 14; al /= 14; rsi[i] = 100.0 if al == 0 else 100.0 - 100.0 / (1.0 + ag / al)
    else:
        ag = (ag * 13 + g) / 14; al = (al * 13 + l) / 14; rsi[i] = 100.0 if al == 0 else 100.0 - 100.0 / (1.0 + ag / al)
rsi_ok = all(abs(rsi[int(r[1])] - float(r[2])) < 1e-4 for r in rows if r[0] == "rsi")
ev = []; ll = lh = -1
for p in range(K + 1, n - K):
    lo_ok = all(L[j] > L[p] for j in range(p - K, p)) and all(L[j] >= L[p] for j in range(p + 1, p + K + 1))
    hi_ok = all(H[j] < H[p] for j in range(p - K, p)) and all(H[j] <= H[p] for j in range(p + 1, p + K + 1))
    if lo_ok:
        if ll >= 0 and MINSEP <= p - ll <= MAXSEP and L[p] < L[ll] and rsi[p] > rsi[ll] + MINDIFF: ev.append((p + K, 1, p, ll))
        ll = p
    if hi_ok:
        if lh >= 0 and MINSEP <= p - lh <= MAXSEP and H[p] > H[lh] and rsi[p] < rsi[lh] - MINDIFF: ev.append((p + K, -1, p, lh))
        lh = p
ref_ev = [(int(r[1]), int(r[2]), int(r[3]), int(r[4])) for r in rows if r[0] == "ev"]
eok = ev == ref_ev
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
    out = []; last = -1
    for i, d, p, q in ev:
        if filt != 0 and d != filt: continue
        if i + 1 > n - 1 or atr[i] <= 0 or i <= last: continue
        entry = O[i + 1]; sl = L[p] - SLBUF * atr[i] if d > 0 else H[p] + SLBUF * atr[i]; risk = d * (entry - sl)
        if risk <= 0 or risk > MAXRISK * atr[i]: continue
        tp = entry + d * RR * risk; res, ex, r = 2, -1, 0.0
        for j in range(i + 1, min(n - 1, i + HOLD) + 1):
            slh = L[j] <= sl if d > 0 else H[j] >= sl; tph = H[j] >= tp if d > 0 else L[j] <= tp
            if slh: res, ex, r = -1, j, -1.0 - COST / risk; break
            if tph: res, ex, r = 1, j, RR - COST / risk; break
            if j == i + HOLD: res, ex, r = 0, j, d * (C[j] - entry) / risk - COST / risk; break
        out.append((i, d, entry, sl, tp, risk, ex, res, r)); last = n if res == 2 else ex
    return out
bad = 0 if (eok and rsi_ok) else 1
print(f"RSI samples {'identical' if rsi_ok else 'DIFF'}; divergence events: {len(ev)} (MT5 {len(ref_ev)}) -> {'identical' if eok else 'DIFF'}")
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
