"""Analyses one cross-terminal copier run (test tool).
Usage: python analyze_cross.py <Common\\Files folder> <label> <results file> [multiplier=0.5]
Reads AT24COPY_XM.txt (master driver log) and AT24COPY_XR.txt (receiver verifier log), both stamped
with the system-uptime millisecond clock, and checks that every master action was mirrored on the
receiver account with the expected volume / SL / TP, and that foreign positions were left alone.
The MT4 verifier already drops a ticket it reads twice while the order pool is updating; rows with
different tickets are never collapsed, so a duplicate copy is reported as a failure."""
import sys, re

folder, label, out_file = sys.argv[1], sys.argv[2], sys.argv[3]
mult = float(sys.argv[4]) if len(sys.argv) > 4 else 0.5


def rd(name):
    return [l.split('|', 2) for l in open(f"{folder}/{name}").read().splitlines() if l]


m, r = rd('AT24COPY_XM.txt'), rd('AT24COPY_XR.txt')
mt = {s: int(t) for t, s, _ in m}
info = {s: i for t, s, i in m}


def fld(step, key):
    mo = re.search(key + r'=([0-9.]+)', info[step])
    return float(mo.group(1))


def rows(state):
    # rows carry the receiver ticket (MT4 verifier) - two rows with different tickets are two REAL copies
    if state.endswith('(none)'):
        return []
    return re.findall(r'\[([\w.]+) (BUY|SELL) (?:#\d+ )?vol=([0-9.]+) sl=([0-9.]+) tp=([0-9.]+) c=([^\]]*)\]', state)


changes = [(int(t), rows(i.split('=', 1)[1])) for t, s, i in r if s == 'CHANGE']
lot = fld('OPEN_BUY', 'vol')
v1 = round(lot * mult, 2)
vrem = round((lot - 0.04) * mult, 2)
vsell = round(0.02 * mult, 2)


def eq(a, b):
    return abs(float(a) - float(b)) < 1e-6


def buys(rs):
    return [x for x in rs if x[1] == 'BUY']


def sells(rs):
    return [x for x in rs if x[1] == 'SELL']


sl1, tp1 = fld('OPEN_BUY', 'sl'), fld('OPEN_BUY', 'tp')
sl2, tp2 = fld('MODIFY', 'sl'), fld('MODIFY', 'tp')
steps = [
    ("OPEN_BUY", lambda rs: len(rs) == 1 and len(buys(rs)) == 1 and eq(buys(rs)[0][2], v1) and eq(buys(rs)[0][3], sl1) and eq(buys(rs)[0][4], tp1) and 'AT24C:' in buys(rs)[0][5]),
    ("MODIFY", lambda rs: len(rs) == 1 and len(buys(rs)) == 1 and eq(buys(rs)[0][2], v1) and eq(buys(rs)[0][3], sl2) and eq(buys(rs)[0][4], tp2)),
    ("PARTIAL_CLOSE", lambda rs: len(rs) == 1 and len(buys(rs)) == 1 and eq(buys(rs)[0][2], vrem) and eq(buys(rs)[0][3], sl2) and eq(buys(rs)[0][4], tp2)),
    ("OPEN_SELL", lambda rs: len(rs) == 2 and len(sells(rs)) == 1 and eq(sells(rs)[0][2], vsell) and len(buys(rs)) == 1),
    ("CLOSE_SELL", lambda rs: len(rs) == 1 and len(buys(rs)) == 1 and eq(buys(rs)[0][2], vrem)),
    ("CLOSE_BUY", lambda rs: len(rs) == 0),
]
out = [f"AT24 Copier CROSS-TERMINAL test - {label}",
       "master  : " + info['INFO'],
       "receiver: " + [i for t, s, i in r if s == 'INFO'][0],
       f"settings: Receiver LotMultiplier={mult}, default ReceiverMagic 8240124; master lot {lot}",
       "clock: system uptime ms (identical in both terminals); latency = master action -> receiver account shows the expected state (polled every 50 ms)",
       ""]
allok = True
for step, fn in steps:
    hit = [t for t, rs in changes if t >= mt[step] and fn(rs)]
    ok = bool(hit)
    allok &= ok
    note = "  (includes the 3 s empty-book confirmation hold)" if step == "CLOSE_BUY" else ""
    out.append(f"{'PASS' if ok else 'FAIL'}  {step:14s} latency {hit[0] - mt[step] if ok else 'n/a'} ms{note}")
end = [i for t, s, i in r if s == 'END'][0]
ok = 'untouched=1' in end
allok &= ok
out.append(("PASS" if ok else "FAIL") + "  foreign orders on the receiver account untouched  [" + end + "]")
out.append("SUMMARY  " + ("all steps passed" if allok else "FAILURES"))
open(out_file, 'w').write("\n".join(out) + "\n")
print("\n".join(out[5:]))
sys.exit(0 if allok else 1)
