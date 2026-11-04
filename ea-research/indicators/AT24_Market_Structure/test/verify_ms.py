"""Independent check of AT24_MS_Core: BOS/CHoCH events and follow-through statistics from the dumped bars.
Usage: python -I verify_ms.py MS_selftest.csv [k] [fwd]"""
import csv, sys

rows = list(csv.reader(open(sys.argv[1])))
k = int(sys.argv[2]) if len(sys.argv) > 2 else 5
fwd = int(sys.argv[3]) if len(sys.argv) > 3 else 20
hi = [float(r[2]) for r in rows if r[0] == "bar"]
lo = [float(r[3]) for r in rows if r[0] == "bar"]
cl = [float(r[4]) for r in rows if r[0] == "bar"]
mt = [(int(r[1]), int(r[2]), float(r[3]), int(r[4]), int(r[5])) for r in rows if r[0] == "ev"]
state = [r for r in rows if r[0] == "state"][0]
mst = [float(x) for x in [r for r in rows if r[0] == "stats"][0][1:]]
n = len(cl)

ev, trend = [], 0
H = L = None  # (price, bar) of latest unbroken pivot
for i in range(n):
    j = i - k
    if j >= k:
        w = [q for q in range(j - k, j + k + 1) if q != j]
        if all(hi[q] < hi[j] for q in w): H = (hi[j], j)
        if all(lo[q] > lo[j] for q in w): L = (lo[j], j)
    if H and cl[i] > H[0]:
        ev.append((i, H[1], H[0], 1, 1 if trend == -1 else 0)); trend = 1; H = None
    if L and cl[i] < L[0]:
        ev.append((i, L[1], L[0], -1, 1 if trend == 1 else 0)); trend = -1; L = None

bad = 0 if len(ev) == len(mt) else 1
for a, b in zip(ev, mt):
    if a[0] != b[0] or a[1] != b[1] or abs(a[2] - b[2]) > 6e-4 or a[3] != b[3] or a[4] != b[4]: bad += 1
print("events python", len(ev), "mt5", len(mt), "mismatches", bad)
print("final trend python", trend, "mt5", state[1])

cnt = {0: [0, 0, 0], 1: [0, 0, 0]}  # total, with data, agree
for e in ev:
    cnt[e[4]][0] += 1
    if e[0] + fwd < n:
        cnt[e[4]][1] += 1
        up = cl[e[0] + fwd] > cl[e[0]]
        if (e[3] == 1) == up and cl[e[0] + fwd] != cl[e[0]]: cnt[e[4]][2] += 1
tot = sum(1 for t in range(n - fwd))
up = sum(1 for t in range(n - fwd) if cl[t + fwd] > cl[t])
py = [cnt[0][0], 100 * cnt[0][2] / cnt[0][1], cnt[1][0], 100 * cnt[1][2] / cnt[1][1], 100 * up / tot, cnt[0][1], cnt[1][1]]
ok = bad == 0 and trend == int(state[1])
for nme, a, b in zip(["bos", "bos_follow%", "choch", "choch_follow%", "base_up%", "bos_n", "choch_n"], py, mst):
    f = abs(a - b) <= 1.1e-3
    ok = ok and f
    print(f"{nme:14s} python {a:9.3f} mt5 {b:9.3f} {'ok' if f else 'DIFF'}")
print("RESULT", "PASS" if ok else "FAIL")
