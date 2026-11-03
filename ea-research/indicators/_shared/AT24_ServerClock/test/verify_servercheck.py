"""Independent check of AT24_ServerClock.mqh using Python's zoneinfo calendar.
Run AT24_ServerClock_SelfTest.mq5 first; it writes MQL5\Files\ServerClock_selftest.csv.
Usage: python verify_servercheck.py <path to ServerClock_selftest.csv>"""
import csv, sys, datetime as dt
from zoneinfo import ZoneInfo
rows = list(csv.reader(open(sys.argv[1])))
meta = [r for r in rows if r[0] == "meta"][0]
ok, base, rule = meta[1], int(meta[2]), int(meta[3])
print("MT5 detected: ok", ok, "base", base, "rule", rule, "(1 fixed, 2 US, 3 EU)", "hits", meta[4], meta[5], "weeks", meta[6])
NY = ZoneInfo("America/New_York"); BER = ZoneInfo("Europe/Berlin"); UTC = dt.timezone.utc
def dst(r, u):
    t = dt.datetime.fromtimestamp(u, UTC)
    if r == 2: return t.astimezone(NY).dst() != dt.timedelta(0)
    if r == 3: return t.astimezone(BER).dst() != dt.timedelta(0)
    return False
weeks = [(int(r[1]), int(r[2])) for r in rows if r[0] == "week"]
bad = sum(1 for u, m in weeks if not (lambda t: t.weekday() == 4 and t.hour == 17 and t.minute == 0)(dt.datetime.fromtimestamp(u, UTC).astimezone(NY)))
print("weekly close instants that are NOT Friday 17:00 New York:", bad, "of", len(weeks))
best = None
for b in range(-12, 15):
    for r in (1, 2, 3):
        rec = sum(1 for k, (u, m) in enumerate(weeks) if k >= len(weeks) - 8 and b + (1 if dst(r, u) else 0) == m)
        allh = sum(1 for (u, m) in weeks if b + (1 if dst(r, u) else 0) == m)
        if best is None or (rec, allh) > best[0]: best = ((rec, allh), b, r)
print("python best (recent, all), base, rule:", best)
conv = [r for r in rows if r[0] == "conv"]
bad2 = 0; fixed_wrong = 0
for r in conv:
    s, g = int(r[1]), int(r[2])
    u = s - base * 3600
    for _ in range(3):
        u = s - (base + (1 if dst(rule, u) else 0)) * 3600
    bad2 += (g != u); fixed_wrong += (g != s - base * 3600)
print("conversion rows", len(conv), "mismatches vs independent calendar:", bad2)
print("rows where a single fixed winter offset would be 1 h wrong: %d of %d (%.1f%%)" % (fixed_wrong, len(conv), 100 * fixed_wrong / len(conv)))
