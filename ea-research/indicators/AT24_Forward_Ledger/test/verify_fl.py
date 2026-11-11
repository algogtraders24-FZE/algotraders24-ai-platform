"""Independent check of AT24_FL_Core: the three ledger rules replayed from three start dates, New York hour vs zoneinfo.
Usage: python -I verify_fl.py FL_selftest.csv"""
import csv, sys, math
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
rows = list(csv.reader(open(sys.argv[1])))
meta = [r for r in rows if r[0] == "meta"][0]; n0, v0 = int(meta[1]), int(meta[2])
bars = [(int(r[1]), int(r[2]), int(r[3]), float(r[4]), float(r[5]), float(r[6]), float(r[7])) for r in rows if r[0] == "bar"]
GM = [b[1] for b in bars]
EVR = [(int(r[1]), r[2], int(r[3]), int(r[4])) for r in rows if r[0] == "ev"]
SN = {"Nonfarm Payrolls", "Average Hourly Earnings m/m", "CPI m/m", "CPI y/y", "Core CPI m/m", "Core PCE Price Index m/m", "Retail Sales m/m", "ISM Manufacturing PMI", "ISM Non-Manufacturing PMI", "GDP q/q"}
res = {(int(r[1]), int(r[2])): [float(x) for x in r[3:]] for r in rows if r[0] == "res"}
NY, UTC = ZoneInfo("America/New_York"), timezone.utc
bad_hr = sum(1 for t, g, hr, *_ in bars if datetime.fromtimestamp(g, UTC).astimezone(NY).hour != hr)
print("New York hour mismatches vs zoneinfo:", bad_hr, "of", len(bars))
# first valid index: first server day with >= 20 bars
days = {}
for i, b in enumerate(bars): days.setdefault(b[0] // 86400, []).append(i)
first = next(v[0] for k, v in sorted(days.items()) if len(v) >= 20)
print("valid-from index python", first, "mt5", v0)
bars = bars[first:]; GM = GM[first:]
T = [b[0] for b in bars]; HR = [b[2] for b in bars]; O = [b[3] for b in bars]; H = [b[4] for b in bars]; L = [b[5] for b in bars]; C = [b[6] for b in bars]; n = len(bars)
atr = [0.0] * n; a = 0.0; s = 0.0
for i in range(n):
    tr = H[i] - L[i] if i == 0 else max(H[i] - L[i], abs(H[i] - C[i - 1]), abs(L[i] - C[i - 1]))
    if i < 14:
        s += tr
        if i == 13: a = s / 14; atr[i] = a
    else:
        a = (a * 13 + tr) / 14; atr[i] = a
def run_relay(start):
    ds = [math.log(C[i] / O[i]) for i in range(n) if T[i] >= start]; drift = 1e4 * sum(ds) / len(ds) if ds else 0.0
    gh = [(g % 86400) // 3600 for g in GM]; gd = [g // 86400 for g in GM]
    rets = []; dirs = []; hd = []; prev = None; i = 0
    while i < n:
        j = i
        while j < n and gd[j] == gd[i]: j += 1
        a = [k for k in range(i, j) if gh[k] < 7]
        if prev is not None and prev[1] >= 6 and prev[0] != 0.0 and a and a[0] == i and gh[a[0]] <= 1 and len(a) >= 6 and T[a[0]] >= start:
            d = 1 if prev[0] > 0 else -1; hold = a[-1] - a[0] + 1
            rets.append(1e4 * d * math.log(C[a[-1]] / O[a[0]])); dirs.append(d); hd.append(d * hold)
        nyk = [k for k in range(i, j) if 13 <= gh[k] < 21]
        prev = (sum(math.log(C[k] / O[k]) for k in nyk), len(nyk)); i = j
    m = len(rets)
    if m == 0: return [0] * 10
    mean = sum(rets) / m; var = (sum(x * x for x in rets) - m * mean * mean) / (m - 1) if m > 1 else 0.0; sd = math.sqrt(max(var, 0))
    md = sum(dirs) / m; adj = mean - (sum(hd) / m) * drift
    return [m, mean, sd, mean / (sd / math.sqrt(m)) if sd > 0 else 0, 100 * sum(x > 0 for x in rets) / m, sum(rets), md, drift, adj, adj / (sd / math.sqrt(m)) if sd > 0 else 0]
def run_events(start):
    import bisect
    ds = [math.log(C[i] / O[i]) for i in range(n) if T[i] >= start]; drift = 1e4 * sum(ds) / len(ds) if ds else 0.0
    off = [T[i] - GM[i] for i in range(n)]                # server minus GMT, per bar (independent clock conversion)
    ev = []
    for t_utc, name, a, f in EVR:
        if name not in SN or a == f: continue
        k = min(bisect.bisect_left(GM, t_utc), n - 1)
        ev.append((t_utc + off[k], -1 if a > f else 1))
    ev.sort(); byhour = {}
    for t, d in ev: byhour[t // 3600 * 3600] = byhour.get(t // 3600 * 3600, 0) + d
    idx = {T[i]: i for i in range(n)}; rets = []; dirs = []; last = -1
    for hb in sorted(byhour):
        net = byhour[hb]
        if net == 0: continue
        e = hb + 3600; bi = idx.get(e)
        if bi is None or bi + 1 >= n or T[bi + 1] != e + 3600 or T[bi] < start or bi <= last: continue
        d = 1 if net > 0 else -1; rets.append(1e4 * d * math.log(C[bi + 1] / O[bi])); dirs.append(d); last = bi + 1
    m = len(rets)
    if m == 0: return [0] * 10
    mean = sum(rets) / m; var = (sum(x * x for x in rets) - m * mean * mean) / (m - 1) if m > 1 else 0.0; sd = math.sqrt(max(var, 0))
    md = sum(dirs) / m; adj = mean - md * 2 * drift
    return [m, mean, sd, mean / (sd / math.sqrt(m)) if sd > 0 else 0, 100 * sum(x > 0 for x in rets) / m, sum(rets), md, drift, adj, adj / (sd / math.sqrt(m)) if sd > 0 else 0]
def run(rule, start):
    if rule == 4: return run_events(start)
    if rule == 3: return run_relay(start)
    ds = [math.log(C[i] / O[i]) for i in range(n) if T[i] >= start]; drift = 1e4 * sum(ds) / len(ds) if ds else 0.0
    hold = (1, 4, 24, 7, 2)[rule]; last = -1; rets = []; dirs = []
    for i in range(15, n):
        entry = ex = -1; d = 0
        if rule == 0:
            if HR[i] == 18 and T[i] >= start: entry = ex = i; d = 1
        elif rule == 1:
            body = C[i] - O[i]
            if atr[i - 1] > 0 and abs(body) >= 2.5 * atr[i - 1] and i + 4 < n and T[i + 1] >= start: entry, ex, d = i + 1, i + 4, (-1 if body > 0 else 1)
        else:
            if i < 120 or i + 24 >= n: continue
            sg = sum(1 if C[i] > C[i - k] else -1 for k in (1, 4, 24, 120))
            if abs(sg) == 4 and T[i + 1] >= start: entry, ex, d = i + 1, i + 24, (1 if sg > 0 else -1)
        if entry < 0 or ex >= n or entry <= last: continue
        rets.append(1e4 * d * math.log(C[ex] / O[entry])); dirs.append(d); last = ex
    m = len(rets)
    if m == 0: return [0] * 11
    mean = sum(rets) / m; var = (sum(x * x for x in rets) - m * mean * mean) / (m - 1) if m > 1 else 0.0; sd = math.sqrt(max(var, 0))
    md = sum(dirs) / m; adj = mean - md * hold * drift
    return [m, mean, sd, mean / (sd / math.sqrt(m)) if sd > 0 else 0, 100 * sum(x > 0 for x in rets) / m, sum(rets), md, drift, adj, adj / (sd / math.sqrt(m)) if sd > 0 else 0]
bad = 0
for (st, rule), ref in sorted(res.items()):
    py = run(rule, st)
    ok = int(ref[0]) == py[0] and all(abs(x - y) < 2e-4 * max(1, abs(y)) for x, y in zip(py[1:], ref[1:]))
    bad += 0 if ok else 1
    dt = datetime.fromtimestamp(st, UTC).date()
    print(f"start {dt} rule {rule}: n {py[0]:3d} mean {py[1]:7.3f} bp t {py[3]:6.2f} hit {py[4]:5.1f}% drift {py[7]:6.3f} adj {py[8]:7.3f} tAdj {py[9]:5.2f}  {'ok' if ok else 'DIFF ' + str(ref)}")
print("RESULT", "PASS" if bad == 0 and bad_hr == 0 and first == v0 else "FAIL")
