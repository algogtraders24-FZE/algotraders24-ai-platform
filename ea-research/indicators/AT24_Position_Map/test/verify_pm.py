"""Independent check of the whole Position Map chain, written from SPEC.md and NOT from the MQL5 code:
 - swings are rebuilt bar by bar as time advances (a mutable chain that pops a swing when a more extreme one of the same type confirms), while the MQL5 side
   precomputes every swing with its confirm / replaced bars;
 - breaks, trend at every W1 and D1 bar, every setup (also the rejected ones), the walk forward, the control, the score and the trend-life statistics are recomputed.
Usage: python -I verify_pm.py PM_selftest.csv"""
import csv, sys, math, bisect, statistics

rows = list(csv.reader(open(sys.argv[1])))
meta = [r for r in rows if r[0] == "meta"][0]
nW, nD, nH, kW, kD, kH = (int(x) for x in meta[1:7])
MINSW, MINRET, BUF, MINRR = (float(x) for x in meta[7:11])
WEEKS = int(meta[11]); COST, SWL, SWS = (float(x) for x in meta[12:15])
SEC_W, SEC_D, SEC_H = 604800, 86400, 14400


def load(tag):
    rs = [r for r in rows if r[0] == tag]
    return ([int(r[1]) for r in rs], [float(r[2]) for r in rs], [float(r[3]) for r in rs], [float(r[4]) for r in rs], [float(r[5]) for r in rs])


tW, oW, hW, lW, cW = load("wbar"); tD, oD, hD, lD, cD = load("dbar"); tH, oH, hH, lH, cH = load("hbar")
assert len(tW) == nW and len(tD) == nD and len(tH) == nH


def atr14(h, l, c):
    n = len(h); tr = []
    for i in range(n):
        tr.append(h[i] - l[i] if i == 0 else max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1])))
    return [0.0 if i < 14 else sum(tr[i - 13:i + 1]) / 14 for i in range(n)]


class Chain:
    """Swings as time advances. advance_to(t) confirms every candidate whose bar + k <= t."""

    def __init__(self, h, l, c, atr, k):
        self.h, self.l, self.c, self.atr, self.k, self.n = h, l, c, atr, k, len(h)
        self.chain = []          # active swings, oldest first
        self.everything = []     # every swing ever added (for the dump comparison)
        self.next = max(k, 14)
        self.brk_cache = {}

    def advance_to(self, t):
        k = self.k
        while self.next + k <= t and self.next <= self.n - 1 - k:
            c = self.next; self.next += 1
            is_h = all(self.h[q] < self.h[c] for q in range(c - k, c + k + 1) if q != c)
            is_l = all(self.l[q] > self.l[c] for q in range(c - k, c + k + 1) if q != c)
            if is_h == is_l: continue
            typ = 1 if is_h else -1; price = self.h[c] if is_h else self.l[c]; conf = c + k
            sw = {"bar": c, "conf": conf, "type": typ, "price": price, "repl": -1}
            if not self.chain:
                self.chain.append(sw); self.everything.append(sw)
            elif self.chain[-1]["type"] == typ:
                last = self.chain[-1]
                if (typ > 0 and price > last["price"]) or (typ < 0 and price < last["price"]):
                    last["repl"] = conf; self.chain.pop(); self.chain.append(sw); self.everything.append(sw)
            elif abs(price - self.chain[-1]["price"]) >= MINSW * self.atr[c]:
                self.chain.append(sw); self.everything.append(sw)

    def brk(self, sw):
        key = sw["bar"]
        if key not in self.brk_cache:
            r = -1
            for j in range(sw["bar"] + 1, self.n):
                if (sw["type"] < 0 and self.c[j] < sw["price"]) or (sw["type"] > 0 and self.c[j] > sw["price"]): r = j; break
            self.brk_cache[key] = r
        return self.brk_cache[key]

    def trend(self, i):
        """Trend at the close of bar i; the chain must already be advanced to i."""
        highs = [s for s in self.chain if s["type"] > 0][-2:]
        lows = [s for s in self.chain if s["type"] < 0][-2:]
        if len(highs) < 2 or len(lows) < 2: return 0
        up = highs[1]["price"] > highs[0]["price"] and lows[1]["price"] > lows[0]["price"]
        dn = highs[1]["price"] < highs[0]["price"] and lows[1]["price"] < lows[0]["price"]
        if up:
            b = self.brk(lows[1]); return 0 if (b >= 0 and b <= i) else 1
        if dn:
            b = self.brk(highs[1]); return 0 if (b >= 0 and b <= i) else -1
        return 0


aW, aD, aH = atr14(hW, lW, cW), atr14(hD, lD, cD), atr14(hH, lH, cH)
fails = 0


def check(name, ok, detail=""):
    global fails
    print(("PASS  " if ok else "FAIL  ") + name + (("  " + detail) if detail else ""))
    if not ok: fails += 1


# ---- swings: final lists and trend at every bar -------------------------------------------------------------------------------
def final_chain(h, l, c, atr, k, n):
    ch = Chain(h, l, c, atr, k); ch.advance_to(n); return ch


chW, chD, chH = final_chain(hW, lW, cW, aW, kW, nW), final_chain(hD, lD, cD, aD, kD, nD), final_chain(hH, lH, cH, aH, kH, nH)
for tag, ch in (("W", chW), ("D", chD), ("H", chH)):
    mine = [(s["bar"], s["conf"], s["type"], round(s["price"], 3), s["repl"], ch.brk(s)) for s in ch.everything]
    theirs = [(int(r[2]), int(r[3]), int(r[4]), round(float(r[5]), 3), int(r[6]), int(r[7])) for r in rows if r[0] == "swing" and r[1] == tag]
    check(f"swings {tag}: every swing identical (bar, confirm bar, type, price, replaced-at, first close beyond)", mine == theirs, f"({len(mine)} swings)")


def trend_series(h, l, c, atr, k, n):
    ch = Chain(h, l, c, atr, k); out = []
    for i in range(n):
        ch.advance_to(i); out.append(ch.trend(i))
    return out


for tag, series in (("trendw", trend_series(hW, lW, cW, aW, kW, nW)), ("trendd", trend_series(hD, lD, cD, aD, kD, nD))):
    theirs = [int(r[2]) for r in rows if r[0] == tag]
    check(f"{tag}: trend identical at every bar", series == theirs, f"(up {series.count(1)}, down {series.count(-1)}, range {series.count(0)})")


# ---- setups (a function of how many W1 / H4 bars exist, so the same code can be run on a CUT history to prove there is no look-ahead) ----------
def run_plans(Wn, Hn):
    tw, hw, lw, cw, aw = tW[:Wn], hW[:Wn], lW[:Wn], cW[:Wn], aW[:Wn]
    th, oh, hh, lh, ch_, ah = tH[:Hn], oH[:Hn], hH[:Hn], lH[:Hn], cH[:Hn], aH[:Hn]

    def walk(d, entry, sl, tp, ei, swap):
        risk = abs(entry - sl)
        for j in range(ei, Hn):
            sl_hit = lh[j] <= sl if d > 0 else hh[j] >= sl
            tp_hit = hh[j] >= tp if d > 0 else lh[j] <= tp
            if sl_hit: st, px = -1, sl
            elif tp_hit: st, px = 1, tp
            elif th[j] - th[ei] >= WEEKS * SEC_W: st, px = 0, ch_[j]
            else: continue
            days = (th[j] - th[ei]) / SEC_D
            return st, j, d * (px - entry) / risk - (COST + swap * days) / risk
        return 2, -1, 0.0

    wchain = Chain(hw, lw, cw, aw, kW); hchain = Chain(hh, lh, ch_, ah, kH)
    wclosed_times = [t + SEC_W for t in tw]
    out = []; busy = {1: -1, -1: -1}; used = {1: -1, -1: -1}
    for h in range(Hn):
        hchain.advance_to(h)
        if ah[h] <= 0: continue
        T = th[h] + SEC_H
        jw = bisect.bisect_right(wclosed_times, T) - 1
        if jw < 0: continue
        wchain.advance_to(jw)
        d = wchain.trend(jw)
        if d == 0 or h <= busy[d]: continue
        chn = wchain.chain
        idx = max((i for i, s_ in enumerate(chn) if s_["type"] == d), default=-1)
        if idx < 1: continue
        top, base = chn[idx], chn[idx - 1]
        leg = d * (top["price"] - base["price"])
        if leg <= 0: continue
        wstart = tw[top["bar"]]
        anchor, ext = -1, 0.0
        for j in range(bisect.bisect_left(th, wstart), h + 1):
            if th[j] >= wstart + SEC_W: break
            v = hh[j] if d > 0 else -lh[j]
            if anchor < 0 or v > ext: anchor, ext = j, v
        if anchor < 0 or anchor >= h: continue
        P = min(lh[anchor + 1:h + 1]) if d > 0 else max(hh[anchor + 1:h + 1])
        depth = (top["price"] - P) / leg if d > 0 else (P - top["price"]) / leg
        if depth < MINRET: continue
        hc = hchain.chain
        i_a = max((i for i, s_ in enumerate(hc) if s_["type"] == -d), default=-1)
        if i_a < 2: continue
        sA, sB, sP = hc[i_a], hc[i_a - 1], hc[i_a - 2]
        turned = sA["price"] > sP["price"] if d > 0 else sA["price"] < sP["price"]
        if not turned or sA["bar"] <= anchor or sB["bar"] <= anchor: continue
        broke = ch_[h] > sB["price"] if d > 0 else ch_[h] < sB["price"]
        if not broke or sA["bar"] == used[d]: continue
        used[d] = sA["bar"]
        ei = h + 1 if h + 1 < Hn else -1
        entry = oh[ei] if ei >= 0 else ch_[h]
        sl = P - BUF * ah[h] if d > 0 else P + BUF * ah[h]
        risk = d * (entry - sl)
        pl = {"dir": d, "trig": h, "ei": ei, "entry": entry, "sl": sl, "tp": 0.0, "risk": risk, "rr": 0.0, "P": P, "B": sB["price"], "st": 3, "ex": -1, "r": 0.0, "rc": 0.0}
        if risk <= 0: pl["st"] = -4
        else:
            tp = P + d * leg
            if d * (tp - entry) <= 0: pl["st"] = -3
            else:
                pl["tp"] = tp; pl["rr"] = d * (tp - entry) / risk
                if pl["rr"] < MINRR: pl["st"] = -2
        if pl["st"] == 3 and ei >= 0:
            st, ex, r = walk(d, entry, sl, pl["tp"], ei, SWL if d > 0 else SWS)
            rc = walk(-d, entry, entry + d * risk, entry - d * pl["rr"] * risk, ei, SWS if d > 0 else SWL)[2]
            pl["st"], pl["ex"], pl["r"], pl["rc"] = st, ex, r, rc
            busy[d] = ex if ex >= 0 else Hn
        out.append(pl)
    return out


plans = run_plans(nW, nH)

theirs = [r for r in rows if r[0] == "plan"]
ok = len(plans) == len(theirs)
bad = []
for a, r in zip(plans, theirs):
    t = (int(r[1]), int(r[2]), int(r[3]), float(r[4]), float(r[5]), float(r[6]), float(r[7]), float(r[8]), float(r[9]), float(r[10]), int(r[11]), int(r[12]), float(r[13]), float(r[14]))
    mine = (a["dir"], a["trig"], a["ei"], a["entry"], a["sl"], a["tp"], a["risk"], a["rr"], a["P"], a["B"], a["st"], a["ex"], a["r"], a["rc"])
    same = all((abs(x - y) <= 7e-4 if isinstance(x, float) and i in (3, 5, 8, 9) else abs(x - y) <= 2e-6 if isinstance(x, float) else x == y) for i, (x, y) in enumerate(zip(mine, t)))
    if not same: bad.append((mine, t))
check("setups: same count", ok, f"({len(plans)} mine, {len(theirs)} dumped)")
check("setups: every field identical (direction, trigger bar, entry bar, entry, stop, target, risk, R:R, pullback, B, status, exit bar, result in R, control in R)", ok and not bad, f"({len(bad)} differ)")
if bad: print("  first difference:", bad[0])
cnt = {}
for a in plans: cnt[a["st"]] = cnt.get(a["st"], 0) + 1
print("  status counts:", dict(sorted(cnt.items())))

# ---- score and control ---------------------------------------------------------------------------------------------------------
M = 0xFFFFFFFF
def rng(seed):
    s = [seed & M]
    def nx():
        x = s[0]; x ^= (x << 13) & M; x ^= x >> 17; x ^= (x << 5) & M; s[0] = x; return x
    return nx
def tt(rs, seed):
    m = len(rs); total = sum(rs); mean = total / m
    var = (sum(v * v for v in rs) - m * mean * mean) / (m - 1); sd = math.sqrt(max(var, 0)); t = mean / (sd / math.sqrt(m)) if sd > 0 else 0
    nx = rng(seed); cnt = 0
    for _ in range(5000):
        s = 0.0
        for v in rs: s += v if (nx() >> 8) & 1 else -v
        if s >= total - 1e-9: cnt += 1
    return total, mean, t, (1 + cnt) / 5001
for ctl in (0, 1):
    rs = [a["rc" if ctl else "r"] for a in plans if a["st"] in (1, -1, 0)]
    rej = sum(1 for a in plans if a["st"] < 0 and a["st"] != -1); op = sum(1 for a in plans if a["st"] in (2, 3))
    row = [r for r in rows if r[0] == "score" and int(r[1]) == ctl][0]
    if len(rs) >= 2:
        total, mean, t, p = tt(rs, 20261117)
        mine = (len(rs), sum(1 for v in rs if v > 0), 100.0 * sum(1 for v in rs if v > 0) / len(rs), mean, total, t, p, op, rej)
    else:
        mine = (len(rs), 0, 0.0, rs[0] if rs else 0.0, rs[0] if rs else 0.0, 0.0, 1.0, op, rej)
    t_ = (int(row[2]), int(row[3]), float(row[4]), float(row[5]), float(row[6]), float(row[7]), float(row[8]), int(row[9]), int(row[10]))
    same = all(abs(x - y) <= 1e-5 for x, y in zip(mine, t_))
    check(f"score {'control (the same trades the other way)' if ctl else 'setups'}: n, wins, hit, average R, total R, t and the sign-flip p identical", same,
          f"(n {mine[0]}, hit {mine[2]:.1f}%, avg R {mine[3]:+.3f}, t {mine[5]:+.2f}, p {mine[6]:.3f})")

# ---- trend life ----------------------------------------------------------------------------------------------------------------
ch = chW.chain
up_w, dn_w = [], []; pU, pD, aU, aD = [], [], [], []; u382 = d382 = u618 = d618 = ub = db = 0
for i in range(len(ch) - 1):
    A, B = ch[i], ch[i + 1]
    weeks = (tW[B["bar"]] - tW[A["bar"]]) / SEC_W
    (up_w if A["type"] < 0 else dn_w).append(weeks)
    if i + 2 >= len(ch): continue
    C = ch[i + 2]; leg = abs(B["price"] - A["price"])
    if leg <= 0: continue
    dep = abs(B["price"] - C["price"]); pct = 100.0 * dep / leg; da = dep / aW[C["bar"]] if aW[C["bar"]] > 0 else 0.0
    if A["type"] < 0:
        pU.append(pct); aU.append(da); u382 += pct >= 38.2; u618 += pct >= 61.8; ub += C["price"] < A["price"]
    else:
        pD.append(pct); aD.append(da); d382 += pct >= 38.2; d618 += pct >= 61.8; db += C["price"] > A["price"]
med = lambda v: statistics.median(v) if v else 0.0
share = lambda c, v: 100.0 * c / len(v) if v else 0.0
mine = [len(up_w), len(dn_w), med(up_w), med(dn_w), len(pU), len(pD), med(pU), med(pD), med(aU), med(aD), share(u382, pU), share(d382, pD), share(u618, pU), share(d618, pD), share(ub, pU), share(db, pD)]
life = [float(x) for x in [r for r in rows if r[0] == "life"][0][1:]]
check("trend life: legs, median weeks, pullback depth (percent and ATR), shares over 38.2 and 61.8 percent, shares that ended the trend", all(abs(a - b) <= 1e-4 for a, b in zip(mine, life)),
      f"(up legs {mine[0]}, median {mine[2]:.1f} weeks; pullbacks after up legs {mine[4]}, median depth {mine[6]:.0f}%)")

# ---- no look-ahead: cut the history, run the same rules, the setups known at the cut must be the same ---------------------------------------------
def trig_fields(a):
    return (a["dir"], a["trig"], a["ei"], round(a["entry"], 6), round(a["sl"], 6), round(a["tp"], 6), round(a["rr"], 6), round(a["P"], 6), round(a["B"], 6), a["st"] < 0)


all_same = True; detail = []
for frac in (0.35, 0.5, 0.65, 0.8, 0.92):
    cut = int(nH * frac)
    wn = bisect.bisect_right([t + SEC_W for t in tW], tH[cut - 1] + SEC_H)
    sub = run_plans(wn, cut)
    full = [a for a in plans if a["trig"] < cut - 1]
    part = [a for a in sub if a["trig"] < cut - 1]
    same = [trig_fields(a) for a in full] == [trig_fields(a) for a in part]
    all_same = all_same and same
    detail.append(f"{cut}:{len(part)}")
check("no look-ahead: on a history cut at 35/50/65/80/92 percent the same setups appear at the same bars with the same levels", all_same, "(setups before each cut: " + ", ".join(detail) + ")")

wt_full = trend_series(hW, lW, cW, aW, kW, nW)
sample_ok = True
for i in range(30, nW, 9):
    chp = Chain(hW[:i + 1], lW[:i + 1], cW[:i + 1], aW[:i + 1], kW); chp.advance_to(i)
    if chp.trend(i) != wt_full[i]: sample_ok = False
check("no look-ahead: the weekly trend at every 9th bar is the same when only the bars up to it exist", sample_ok)

print("\nALL CHECKS PASSED" if fails == 0 else f"\n{fails} CHECK(S) FAILED")
sys.exit(0 if fails == 0 else 1)
