"""AT24 Research Lab 05 - three popular trader beliefs about compression and round numbers, tested on gold.

PRE-REGISTRATION (written 2026-11-11 BEFORE any result of this script was seen; XAUUSD H1, one broker feed, from the first full hourly day 2021-05-05;
spread field not used; cost 0.25 USD per round trip where a trade return is measured).

  S1  "Compression breakouts run."  Compression = ATR(14) / ATR(100) <= 0.75 measured on the bar BEFORE the signal bar (simple means of the true range).
      A breakout = the signal bar closes beyond the highest high / lowest low of the previous 12 bars; direction = the break. Enter at the next open,
      exit at the close 12 bars later, no overlapping trades. Return in units of ATR(14) of the bar before the signal, minus the cost.
      Test: mean return of compression breakouts MINUS mean return of non-compression breakouts, permutation test (labels shuffled).
  S2  "Round numbers reject price."  Levels = multiples of 50 USD. An up-touch bar: opens at least 0.1 ATR(14) below the level and its high reaches it
      (down-touch mirrored). Fade return = move AGAINST the touch direction from the touch bar close to the close 4 bars later, in ATR units
      (first touch per level crossing, no event within 4 bars of the previous one of the same kind). Control = the same procedure on levels at the
      midpoints (25 USD offsets: 25, 75, 125, ...). Test: mean fade return at round levels MINUS control, permutation test.
  S3  "A quiet London session coils the spring for New York."  Per GMT day: London range (GMT 07-13) and NY range (GMT 13-21). A quiet London day =
      London range <= the 25th percentile of the previous 60 days' London ranges. Outcome = NY range divided by the median NY range of the previous
      60 days. Test: mean outcome on quiet-London days MINUS other days, permutation test.
  Family of 3, Bonferroni alpha = 0.05 / 3 = 0.0167. Periods: train 2021-05-05..2023-12-31, validation 2024-01-01..2025-06-30, final 2025-07-01..end.
  FINDING only if p_train < alpha AND same sign with p_val < 0.05 AND same sign in final (p_final < 0.10 or fewer than 30 events in final).
Seeds fixed. Results are reported whatever they are.
"""
import sys, json
import numpy as np, pandas as pd
rng = np.random.default_rng(20261113)
D = sys.argv[1] if len(sys.argv) > 1 else "E:/at24_lab_data"
BONF = 0.05 / 3; COST = 0.25
T1, T2 = pd.Timestamp("2024-01-01", tz="UTC"), pd.Timestamp("2025-07-01", tz="UTC")
h = pd.read_csv(f"{D}/lab_xauusd_h1.csv"); h["utc"] = pd.to_datetime(h["gmt"], unit="s", utc=True)
tday = (h["utc"] + pd.Timedelta(hours=6)).dt.date  # coarse day key only for the validity guard
cnt = h.groupby(h["utc"].dt.date).size(); first_ok = cnt[cnt >= 20].index[0]
h = h[h["utc"].dt.date >= first_ok].reset_index(drop=True)
h["period"] = np.where(h["utc"] < T1, "train", np.where(h["utc"] < T2, "val", "final"))
o, hi, lo, c = h["open"].values, h["high"].values, h["low"].values, h["close"].values
tr = np.maximum(hi - lo, np.maximum(np.abs(hi - np.roll(c, 1)), np.abs(lo - np.roll(c, 1)))); tr[0] = hi[0] - lo[0]
atr14 = pd.Series(tr).rolling(14).mean().values; atr100 = pd.Series(tr).rolling(100).mean().values
n = len(h); R = {}

def perm_diff(a, b, k=10000):
    a, b = np.asarray(a, float), np.asarray(b, float); d0 = a.mean() - b.mean(); pool = np.concatenate([a, b]); cn = 0
    for _ in range(k):
        rng.shuffle(pool)
        if abs(pool[:len(a)].mean() - pool[len(a):].mean()) >= abs(d0): cn += 1
    return float(d0), float((1 + cn) / (k + 1))
def verdict(pt, pv, pf, st, sv, sf, nf):
    return bool(pt < BONF and pv < 0.05 and st * sv > 0 and st * sf > 0 and (pf < 0.10 or nf < 30))
def report(ev, ca, cb, key, label_a, label_b):
    """ev: DataFrame with period, group (a/b), val. Returns the per-period permutation results."""
    out = {}
    for per in ["train", "val", "final"]:
        d = ev[ev["period"] == per]; a = d[d["group"] == "a"]["val"]; b = d[d["group"] == "b"]["val"]
        if len(a) < 8 or len(b) < 8: out[per] = dict(n_a=int(len(a)), n_b=int(len(b)), diff=0.0, p=1.0); continue
        d0, p0 = perm_diff(a, b)
        out[per] = dict(n_a=int(len(a)), n_b=int(len(b)), mean_a=float(a.mean()), mean_b=float(b.mean()), diff=d0, p=p0)
    out["finding"] = verdict(out["train"]["p"], out["val"]["p"], out["final"]["p"], out["train"]["diff"], out["val"]["diff"], out["final"]["diff"], out["final"]["n_a"])
    out["labels"] = [label_a, label_b]
    return out

# ---------------- S1 compression breakouts ----------------
rows = []; last_exit = -1
for t in range(120, n - 13):
    if t <= last_exit: continue
    if np.isnan(atr14[t - 1]) or np.isnan(atr100[t - 1]) or atr14[t - 1] <= 0: continue
    hh, ll = hi[t - 12:t].max(), lo[t - 12:t].min(); d = 0
    if c[t] > hh: d = 1
    elif c[t] < ll: d = -1
    if d == 0: continue
    entry, ex = t + 1, t + 12
    ret = (d * (c[ex] - o[entry]) - COST) / atr14[t - 1]
    comp = atr14[t - 1] / atr100[t - 1] <= 0.75
    rows.append(dict(period=h["period"].iloc[t], group="a" if comp else "b", val=ret)); last_exit = ex
R["S1"] = report(pd.DataFrame(rows), None, None, "S1", "compression breakouts (ATR units, net of cost)", "other breakouts")

# ---------------- S2 round numbers vs midpoint control ----------------
def touches(offset):
    ev = []; last = -10
    for t in range(120, n - 5):
        if np.isnan(atr14[t]) or atr14[t] <= 0 or t < last + 4: continue
        a = atr14[t]
        up = (np.floor((o[t] - offset) / 50) + 1) * 50 + offset      # lowest level above the open
        dn = np.floor((o[t] - offset) / 50) * 50 + offset            # highest level below the open (could equal the open)
        d = 0
        if hi[t] >= up and o[t] <= up - 0.1 * a: d = 1
        elif lo[t] <= dn and o[t] >= dn + 0.1 * a: d = -1
        if d == 0: continue
        ev.append(dict(period=h["period"].iloc[t], val=-d * (c[t + 4] - c[t]) / a)); last = t
    return ev
ra, ctrl = touches(0), touches(25)
ev = pd.DataFrame([dict(e, group="a") for e in ra] + [dict(e, group="b") for e in ctrl])
R["S2"] = report(ev, None, None, "S2", "fade return at round 50 levels (ATR units)", "fade return at 25-offset control levels")

# ---------------- S3 quiet London -> big New York ----------------
h["gday"] = h["utc"].dt.floor("D"); h["gh"] = h["utc"].dt.hour
lon = h[(h["gh"] >= 7) & (h["gh"] < 13)].groupby("gday").agg(hi=("high", "max"), lo=("low", "min"), n=("high", "size"))
ny = h[(h["gh"] >= 13) & (h["gh"] < 21)].groupby("gday").agg(hi=("high", "max"), lo=("low", "min"), n=("high", "size"))
df = pd.concat([lon.add_prefix("l_"), ny.add_prefix("n_")], axis=1, join="inner"); df = df[(df["l_n"] >= 5) & (df["n_n"] >= 7)]
df["lr"] = df["l_hi"] - df["l_lo"]; df["nr"] = df["n_hi"] - df["n_lo"]
df["lq"] = df["lr"].shift(1).rolling(60).quantile(0.25); df["nm"] = df["nr"].shift(1).rolling(60).median()
df = df.dropna(); df["quiet"] = df["lr"] <= df["lq"]; df["out"] = df["nr"] / df["nm"]
df["period"] = np.where(df.index < T1, "train", np.where(df.index < T2, "val", "final"))
R["S3"] = report(pd.DataFrame(dict(period=df["period"], group=np.where(df["quiet"], "a", "b"), val=df["out"])), None, None, "S3", "NY range / usual NY range after a quiet London", "after other London sessions")
json.dump(R, open(sys.argv[2] if len(sys.argv) > 2 else "lab05_results.json", "w"), indent=1)
for k in ["S1", "S2", "S3"]: print(k, json.dumps(R[k]))
