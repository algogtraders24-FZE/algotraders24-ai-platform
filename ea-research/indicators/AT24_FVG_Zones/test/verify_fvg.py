"""Independent check of AT24_FVG_Core: gaps, touch/fill bars and statistics from the dumped bars.
Usage: python -I verify_fvg.py FVG_selftest.csv"""
import csv, sys, statistics

rows = list(csv.reader(open(sys.argv[1])))
hi = [float(r[2]) for r in rows if r[0] == "bar"]
lo = [float(r[3]) for r in rows if r[0] == "bar"]
cl = [float(r[4]) for r in rows if r[0] == "bar"]
mt = [(int(r[1]), int(r[2]), float(r[3]), float(r[4]), int(r[5]), int(r[6])) for r in rows if r[0] == "gap"]
mst = [float(x) for x in [r for r in rows if r[0] == "stats"][0][1:]]
n = len(cl); LEN, MINATR, WIN, REACT = 14, 0.3, 50, 20

tr = [hi[0] - lo[0]] + [max(hi[i] - lo[i], abs(hi[i] - cl[i - 1]), abs(lo[i] - cl[i - 1])) for i in range(1, n)]
atr = [0.0] * n
atr[LEN - 1] = sum(tr[:LEN]) / LEN
for i in range(LEN, n): atr[i] = (atr[i - 1] * (LEN - 1) + tr[i]) / LEN

gaps = []
for i in range(max(2, LEN), n):
    if lo[i] > hi[i - 2]: d, top, bot = 1, lo[i], hi[i - 2]
    elif hi[i] < lo[i - 2]: d, top, bot = -1, lo[i - 2], hi[i]
    else: continue
    if top - bot < MINATR * atr[i]: continue
    touch = fill = -1
    for t in range(i + 1, n):
        tc = lo[t] <= top if d == 1 else hi[t] >= bot
        fl = lo[t] <= bot if d == 1 else hi[t] >= top
        if tc and touch < 0: touch = t
        if fl: fill = t; break
    gaps.append((i, d, top, bot, touch, fill))

bad = 0 if len(gaps) == len(mt) else 1
for a, b in zip(gaps, mt):
    if a[0] != b[0] or a[1] != b[1] or abs(a[2] - b[2]) > 6e-4 or abs(a[3] - b[3]) > 6e-4 or a[4] != b[4] or a[5] != b[5]: bad += 1
print("gaps python", len(gaps), "mt5", len(mt), "mismatches", bad)

cnt = tch = fil = rc = cn = ct = 0; wait = []
for (i, d, top, bot, touch, fill) in gaps:
    if i + WIN >= n: continue
    cnt += 1
    if touch >= 0 and touch - i <= WIN:
        tch += 1; wait.append(touch - i); h = top - bot
        for u in range(touch, min(n - 1, touch + REACT) + 1):
            if (cl[u] < bot) if d == 1 else (cl[u] > top): break
            if (hi[u] >= top + h) if d == 1 else (lo[u] <= bot - h): rc += 1; break
    if fill >= 0 and fill - i <= WIN: fil += 1
    c = i + 100
    if c + WIN < n:
        dist = cl[i] - top if d == 1 else bot - cl[i]
        if dist > 0:
            cn += 1; lvl = cl[c] - dist if d == 1 else cl[c] + dist
            for t in range(c + 1, c + WIN + 1):
                if (lo[t] <= lvl) if d == 1 else (hi[t] >= lvl): ct += 1; break
py = [cnt, 100 * tch / cnt, 100 * fil / cnt, statistics.median(wait), 100 * ct / cn, 100 * rc / tch, tch]
ok = bad == 0
for nme, a, b in zip(["measured", "touched%", "filled%", "medWait", "control%", "reacted%", "touchedN"], py, mst):
    f = abs(a - b) <= 1.1e-3
    ok = ok and f
    print(f"{nme:10s} python {a:9.3f} mt5 {b:9.3f} {'ok' if f else 'DIFF'}")
print("RESULT", "PASS" if ok else "FAIL")
