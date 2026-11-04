"""Independent check of AT24_NYOR: (1) server->GMT->New York conversion against Python zoneinfo,
(2) Opening Range days and statistics recomputed from the dumped bars.
Usage: python -I verify_nyor.py NYOR_selftest.csv"""
import csv, sys, statistics
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo

rows = list(csv.reader(open(sys.argv[1])))
meta = [r for r in rows if r[0] == "meta"][0]
base, rule = int(meta[2]), int(meta[3])
bars = [(int(r[1]), int(r[2]), int(r[3]), float(r[4]), float(r[5]), float(r[6])) for r in rows if r[0] == "bar"]
mt = [r for r in rows if r[0] == "day"]
mst = [float(x) for x in [r for r in rows if r[0] == "stats"][0][1:]]
mct = [float(x) for x in [r for r in rows if r[0] == "control"][0][1:]]
NY, UTC = ZoneInfo("America/New_York"), timezone.utc

# (1) conversion: GMT is server minus (base + 1 while the US is on summer time); NY local from zoneinfo
bad_conv = 0
for (srv, gmt, ny, h, l, c) in bars:
    d = datetime.fromtimestamp(gmt, UTC).astimezone(NY)
    ny_exp = int(d.replace(tzinfo=UTC).timestamp()) - 0  # wall clock labelled as UTC
    # server offset by the US rule (server follows New York: base 2 + 1 in US DST)
    us_dst = d.dst() != timedelta(0)
    srv_exp = gmt + (base + (1 if (rule == 2 and us_dst) else 0)) * 3600
    if ny != ny_exp or srv != srv_exp: bad_conv += 1
print("conversion mismatches", bad_conv, "of", len(bars), "(rule", rule, "base", base, ")")

# (2) opening range
def analyze(start, ln, end, fake=4, buf=0.0):
    days = {}
    order = []
    for i, (srv, gmt, ny, h, l, c) in enumerate(bars):
        key, mn = ny // 86400, (ny % 86400) // 60
        if key not in days:
            days[key] = dict(key=key, first=-1, orEnd=-1, hi=0.0, lo=0.0, brk=0, brkBar=-1, held=0, fake=0, ran=0, last=-1, comp=False)
            order.append(key)
        d = days[key]
        if start <= mn < start + ln:
            if d["first"] < 0: d["first"], d["hi"], d["lo"] = i, h, l
            else: d["hi"], d["lo"] = max(d["hi"], h), min(d["lo"], l)
            d["orEnd"] = i
        elif start + ln <= mn <= end and d["first"] >= 0:
            d["last"] = i
            if d["brk"] == 0:
                if c > d["hi"] + buf: d["brk"], d["brkBar"] = 1, i
                elif c < d["lo"] - buf: d["brk"], d["brkBar"] = -1, i
    out = [days[k] for k in order]
    for d in out:
        if d["first"] < 0 or d["last"] < 0: continue
        d["comp"] = True
        if d["brk"] == 0: continue
        hgt = d["hi"] - d["lo"]; b, e = d["brkBar"], d["last"]
        d["held"] = int(bars[e][5] > d["hi"]) if d["brk"] == 1 else int(bars[e][5] < d["lo"])
        for q in range(b + 1, min(e, b + fake) + 1):
            if d["lo"] <= bars[q][5] <= d["hi"]: d["fake"] = 1; break
        for q in range(b, e + 1):
            if (bars[q][3] >= d["hi"] + hgt) if d["brk"] == 1 else (bars[q][4] <= d["lo"] - hgt): d["ran"] = 1; break
    return out

def stats(days):
    cd = [d for d in days if d["comp"]]
    m = len(cd); br = [d for d in cd if d["brk"] != 0]
    return [m, 100 * sum(d["brk"] == 1 for d in cd) / m, 100 * sum(d["brk"] == -1 for d in cd) / m, 100 * sum(d["brk"] == 0 for d in cd) / m,
            100 * sum(d["held"] for d in br) / len(br), 100 * sum(d["fake"] for d in br) / len(br), 100 * sum(d["ran"] for d in br) / len(br),
            statistics.median(d["hi"] - d["lo"] for d in cd), len(br)]

days = analyze(570, 30, 960)
bad = 0 if len(days) == len(mt) else 1
for a, b in zip(days, mt):
    bb = [int(b[1]), int(b[2]), int(b[3]), float(b[4]), float(b[5]), int(b[6]), int(b[7]), int(b[8]), int(b[9]), int(b[10]), int(b[11]), int(b[12])]
    aa = [a["key"], a["first"], a["orEnd"], a["hi"], a["lo"], a["brk"], a["brkBar"], a["held"], a["fake"], a["ran"], a["last"], int(a["comp"])]
    if any(abs(x - y) > 6e-4 if isinstance(x, float) else x != y for x, y in zip(aa, bb)): bad += 1
print("days python", len(days), "mt5", len(mt), "mismatches", bad)
ok = bad == 0 and bad_conv == 0
for label, py, ref in (("main", stats(days), mst), ("control 11:00", stats(analyze(660, 30, 960)), mct)):
    for nme, a, b in zip(["days", "up%", "down%", "none%", "held%", "fake%", "ran%", "medHeight", "broken"], py, ref):
        f = abs(a - b) <= 1.1e-3
        ok = ok and f
        print(f"{label:14s} {nme:9s} python {a:9.3f} mt5 {b:9.3f} {'ok' if f else 'DIFF'}")
print("RESULT", "PASS" if ok else "FAIL")
