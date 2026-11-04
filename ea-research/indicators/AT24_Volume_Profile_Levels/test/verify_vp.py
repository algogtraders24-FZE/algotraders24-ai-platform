"""Independent check of AT24_VP_Core: daily volume profile (POC, value area) and the previous-day-level study.
Usage: python -I verify_vp.py VP_selftest.csv"""
import csv, sys, math
rows = list(csv.reader(open(sys.argv[1])))
bars = [(int(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5]), float(r[6])) for r in rows if r[0] == "bar"]
mtd = [(int(r[1]), int(r[2]), float(r[3]), float(r[4]), float(r[5]), int(r[6])) for r in rows if r[0] == "day"]
mts = {r[1]: [float(x) for x in r[2:]] for r in rows if r[0] == "study"}
n = len(bars); BINS, VA, LOOK, FRAC = 60, 0.70, 24, 0.15
T = [b[0] for b in bars]; O = [b[1] for b in bars]; H = [b[2] for b in bars]; L = [b[3] for b in bars]; C = [b[4] for b in bars]; V = [b[5] for b in bars]
days = []; cur = None
for i in range(n):
    dk = T[i] // 86400
    if dk != cur:
        cur = dk; days.append(dict(first=i, last=i, hi=H[i], lo=L[i], ok=False, poc=0, vah=0, val=0))
    else:
        d = days[-1]; d["last"] = i; d["hi"] = max(d["hi"], H[i]); d["lo"] = min(d["lo"], L[i])
for d in days:
    rng = d["hi"] - d["lo"]
    if rng <= 0: continue
    bw = rng / BINS; prof = [0.0] * BINS; total = 0.0
    for i in range(d["first"], d["last"] + 1):
        v = V[i]
        if v <= 0: continue
        lo, hi = L[i], H[i]; total += v
        if hi - lo <= 0:
            prof[min(BINS - 1, int(math.floor((lo - d["lo"]) / bw)))] += v; continue
        b1 = min(BINS - 1, int(math.floor((lo - d["lo"]) / bw))); b2 = min(BINS - 1, int(math.floor((hi - d["lo"]) / bw)))
        for b in range(b1, b2 + 1):
            bl = d["lo"] + b * bw; bh = bl + bw
            ov = min(hi, bh) - max(lo, bl)
            if ov > 0: prof[b] += v * ov / (hi - lo)
    if total <= 0: continue
    pb = 0
    for b in range(1, BINS):
        if prof[b] > prof[pb]: pb = b
    lo_i = up_i = pb; acc = prof[pb]
    while acc < VA * total and (lo_i > 0 or up_i < BINS - 1):
        dn = prof[lo_i - 1] if lo_i > 0 else -1.0; ab = prof[up_i + 1] if up_i < BINS - 1 else -1.0
        if ab >= dn: up_i += 1; acc += prof[up_i]
        else: lo_i -= 1; acc += prof[lo_i]
    d["poc"] = d["lo"] + (pb + 0.5) * bw; d["vah"] = d["lo"] + (up_i + 1) * bw; d["val"] = d["lo"] + lo_i * bw; d["ok"] = True
bad = 0 if len(days) == len(mtd) else 1
for a, b in zip(days, mtd):
    if a["first"] != b[0] or a["last"] != b[1] or int(a["ok"]) != b[5]: bad += 1; continue
    if a["ok"] and (abs(a["poc"] - b[2]) > 1e-4 or abs(a["vah"] - b[3]) > 1e-4 or abs(a["val"] - b[4]) > 1e-4): bad += 1
print("days python", len(days), "mt5", len(mtd), "profile mismatches", bad)
ok_all = bad == 0
for l, nm in enumerate(["POC", "VAH", "VAL"]):
    dn = tc = ct = rc = dc = crc = cdc = 0
    for k in range(1, len(days)):
        if not days[k - 1]["ok"]: continue
        p = days[k - 1]; lvl = (p["poc"], p["vah"], p["val"])[l]; R = p["hi"] - p["lo"]; op = O[days[k]["first"]]
        if op == lvl: continue
        dn += 1
        for pas in (0, 1):
            Lx = lvl if pas == 0 else op + (op - lvl); s = 1.0 if op > Lx else -1.0
            tb = -1
            for i in range(days[k]["first"], days[k]["last"] + 1):
                if L[i] <= Lx <= H[i]: tb = i; break
            if tb < 0: continue
            if pas == 0: tc += 1
            else: ct += 1
            res = 0
            for u in range(tb, min(days[k]["last"], tb + LOOK) + 1):
                away, beyond = (C[u] - Lx) * s, (C[u] - Lx) * (-s)
                if away >= FRAC * R: res = 1; break
                if beyond >= FRAC * R: res = -1; break
            if res:
                if pas == 0: dc += 1; rc += (res == 1)
                else: cdc += 1; crc += (res == 1)
    py = [dn, 100 * tc / dn, 100 * ct / dn, 100 * rc / dc if dc else 0, 100 * crc / cdc if cdc else 0, dc]
    ok = all(abs(a - b) < 1e-4 for a, b in zip(py, mts[nm]))
    ok_all &= ok
    print(f"{nm}: days {py[0]} touch {py[1]:.1f}% (control {py[2]:.1f}%)  reacted {py[3]:.1f}% of {py[5]} (control {py[4]:.1f}%)  {'ok' if ok else 'DIFF ' + str(mts[nm])}")
print("RESULT", "PASS" if ok_all else "FAIL")
