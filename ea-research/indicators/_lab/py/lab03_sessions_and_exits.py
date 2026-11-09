"""AT24 Research Lab 03 - session sweeps graded in R, breakout entries against random entries, session relay, and where the day's extremes form.

Inspired by what the MQL5 community published in Oct/Nov 2026 (self-grading sweep scorecards, Donchian breakout exit labs, session killzones) - but tested properly.

PRE-REGISTRATION (written before any result was looked at):
  Data: XAUUSD H1 from the first full-coverage day (2021-05) to 2026-11 (Equiti server feed). GMT sessions: Asia 00-07, London 07-13, New York 13-21.
  Periods (by entry/day date): TRAIN 2021-05..2022-12, VALIDATION 2023-01..2024-12, FINAL 2025-01..2026-11.
  Family-wise alpha 0.05 over 6 tests -> Bonferroni 0.0083.
  FINDING = p_train < 0.0083 AND same sign with p_validation < 0.05 AND same sign in FINAL (p < 0.10, or sign only if n < 30).
  Tests:
   S1 Asian-range sweep reversal. Range = high/low of GMT 00-07 H1 bars. Between GMT 07 and 13 the first bar that trades beyond one side and CLOSES back inside is a sweep
      (bars that sweep both sides are skipped). Trade the reversal: enter at the next bar's open, stop at the sweep bar's extreme, target 1R, time exit GMT 16:00, stop wins a same-bar tie.
      Cost 0.25 USD per trade (fixed, stated). Statistic: mean net R per trade (t-test).
   B1 Donchian breakout entries versus random entries. H4 bars (GMT blocks). Entry: close above the previous 20 H4 highs and above EMA200, enter next open, stop 2 ATR(20), target 2R, time exit 60 bars.
      Control: the same exits from random entry bars among bars with close above EMA200. Statistic: mean net R of the breakout entries minus the random-entry mean (null = 5,000 random draws of the same number of entries).
   R1 session relay: correlation of the return of Asia -> London (R1a), London -> New York (R1b), New York -> next Asia (R1c) (day permutation null).
   X1 extreme timing: do the day's highest and lowest hourly closes occur in the FIRST half of the trading day (18:00 NY start) more or less often than a random order of the same hourly moves predicts?
      Surrogate = the same day's hourly returns shuffled (1,000 surrogate sets). Statistic: real share minus surrogate share.
"""
import sys, json, math
import numpy as np, pandas as pd
from scipy import stats
from zoneinfo import ZoneInfo
rng = np.random.default_rng(20261111)
NY = ZoneInfo("America/New_York"); D = sys.argv[1] if len(sys.argv) > 1 else "E:/at24_lab_data"
BONF = 0.05 / 6; COST = 0.25
T1, T2 = pd.Timestamp("2023-01-01", tz="UTC"), pd.Timestamp("2025-01-01", tz="UTC")
h = pd.read_csv(f"{D}/lab_xauusd_h1.csv"); h["utc"] = pd.to_datetime(h["gmt"], unit="s", utc=True); h["ny"] = h["utc"].dt.tz_convert(NY)
h["hour_ny"] = h["ny"].dt.hour; h["tday"] = (h["ny"] + pd.Timedelta(hours=6)).dt.date
cov = h.groupby("tday")["hour_ny"].nunique(); h = h[h["tday"] >= cov[cov >= 22].index[0]].reset_index(drop=True)
h["gday"] = h["utc"].dt.floor("D"); h["ghour"] = h["utc"].dt.hour
h["period"] = np.where(h["utc"] < T1, "train", np.where(h["utc"] < T2, "val", "final"))
R = {}

def verdict(pt, pv, pf, st, sv, sf, nf):
    return bool(pt < BONF and pv < 0.05 and st * sv > 0 and st * sf > 0 and (pf < 0.10 or nf < 30))

def t_test(x):
    x = np.asarray(x, float)
    if len(x) < 3: return dict(n=int(len(x)), mean=float(x.mean()) if len(x) else 0.0, t=0.0, p=1.0)
    t = stats.ttest_1samp(x, 0.0)
    return dict(n=int(len(x)), mean=float(x.mean()), hit=float((x > 0).mean()), t=float(t.statistic), p=float(t.pvalue))

# ---------------- S1 Asian sweep reversal ----------------
trades = []
for gday, g in h.groupby("gday"):
    asia = g[g["ghour"] < 7]; win = g[(g["ghour"] >= 7) & (g["ghour"] <= 12)]
    if len(asia) < 6 or len(win) < 4: continue
    hi, lo = asia["high"].max(), asia["low"].min()
    sweep = None
    for idx, b in win.iterrows():
        up = b["high"] > hi and b["close"] <= hi; dn = b["low"] < lo and b["close"] >= lo
        if up and dn: break
        if up: sweep = (idx, -1, b["high"]); break
        if dn: sweep = (idx, 1, b["low"]); break
    if not sweep: continue
    idx, d, ext = sweep
    if idx + 1 >= len(h) or h.loc[idx + 1, "gday"] != gday: continue
    entry = h.loc[idx + 1, "open"]; stop = ext
    R_ = abs(entry - stop)
    if R_ <= 0.5: continue
    target = entry + d * R_; res = None
    for j in range(idx + 1, min(idx + 12, len(h))):
        b = h.loc[j]
        if b["gday"] != gday or b["ghour"] >= 16: res = (b["open"] - entry) * d if j > idx + 1 else 0.0; break
        hit_stop = (b["low"] <= stop) if d == 1 else (b["high"] >= stop)
        hit_tgt = (b["high"] >= target) if d == 1 else (b["low"] <= target)
        if hit_stop: res = -R_; break
        if hit_tgt: res = R_; break
    if res is None: res = (h.loc[min(idx + 11, len(h) - 1), "close"] - entry) * d
    trades.append(dict(t=h.loc[idx + 1, "utc"], R=(res - COST) / R_, period=h.loc[idx + 1, "period"], dir=d))
tr = pd.DataFrame(trades)
S1 = {per: t_test(tr[tr["period"] == per]["R"]) for per in ["train", "val", "final"]}
S1["all"] = t_test(tr["R"]); S1["by_direction"] = {("long" if d == 1 else "short"): t_test(tr[tr["dir"] == d]["R"]) for d in (1, -1)}
S1["finding"] = verdict(S1["train"]["p"], S1["val"]["p"], S1["final"]["p"], S1["train"]["mean"], S1["val"]["mean"], S1["final"]["mean"], S1["final"]["n"])
R["S1"] = S1

# ---------------- B1 breakout vs random entries ----------------
h["blk"] = (h["utc"].dt.floor("4h"))
h4 = h.groupby("blk").agg(open=("open", "first"), high=("high", "max"), low=("low", "min"), close=("close", "last"), n=("open", "size")).reset_index()
h4 = h4[h4["n"] >= 3].reset_index(drop=True)
h4["ema200"] = h4["close"].ewm(span=200, adjust=False).mean()
h4["hh20"] = h4["high"].rolling(20).max().shift(1)
trr = np.maximum.reduce([h4["high"] - h4["low"], (h4["high"] - h4["close"].shift()).abs(), (h4["low"] - h4["close"].shift()).abs()])
h4["atr20"] = pd.Series(trr).rolling(20).mean()
op, hi4, lo4, cl4 = h4["open"].values, h4["high"].values, h4["low"].values, h4["close"].values; atr20 = h4["atr20"].values
def sim_trade(i):
    """long entry at open of bar i, stop 2 ATR(20) (measured at i-1), target 2R, time exit after 60 bars; stop wins same-bar ties; returns net R"""
    a = atr20[i - 1]
    if np.isnan(a) or a <= 0: return None
    entry = op[i]; stop = entry - 2 * a; R_ = 2 * a; tgt = entry + 2 * R_
    for j in range(i, min(i + 60, len(h4))):
        if lo4[j] <= stop: return (-R_ - COST) / R_
        if hi4[j] >= tgt: return (2 * R_ - COST) / R_
    j = min(i + 59, len(h4) - 1)
    return (cl4[j] - entry - COST) / R_
elig = [i for i in range(201, len(h4) - 61) if cl4[i - 1] > h4["ema200"].values[i - 1]]
brk = [i for i in elig if cl4[i - 1] > h4["hh20"].values[i - 1]]
rb = {i: sim_trade(i) for i in set(elig)}
per_of = lambda i: ("train" if h4["blk"].iloc[i] < T1 else ("val" if h4["blk"].iloc[i] < T2 else "final"))
B1 = {}
for per in ["train", "val", "final"]:
    e = [i for i in elig if per_of(i) == per and rb[i] is not None]; b = [i for i in brk if per_of(i) == per and rb.get(i) is not None]
    if len(b) < 5: B1[per] = dict(n_breakout=len(b), p=1.0, diff=0.0); continue
    rr = np.array([rb[i] for i in e]); bb = np.array([rb[i] for i in b])
    d0 = bb.mean() - rr.mean(); cnt = 0
    for _ in range(5000):
        s_ = rng.choice(rr, size=len(bb), replace=False if len(rr) >= len(bb) else True)
        if abs(s_.mean() - rr.mean()) >= abs(d0): cnt += 1
    B1[per] = dict(n_breakout=int(len(bb)), mean_breakout_R=float(bb.mean()), hit_breakout=float((bb > 0).mean()), n_eligible=int(len(rr)), mean_random_R=float(rr.mean()), diff=float(d0), p=float((1 + cnt) / 5001))
B1["finding"] = verdict(B1["train"]["p"], B1["val"]["p"], B1["final"]["p"], B1["train"]["diff"], B1["val"]["diff"], B1["final"]["diff"], B1["final"]["n_breakout"])
R["B1"] = B1

# ---------------- R1 session relay ----------------
def sess(lo, hi):
    g = h[(h["ghour"] >= lo) & (h["ghour"] < hi)].copy(); g["ret"] = np.log(g["close"] / g["open"])
    return g.groupby("gday")["ret"].sum()
asia, lon, nyc = sess(0, 7), sess(7, 13), sess(13, 21)
dfs = pd.concat([asia, lon, nyc], axis=1, join="inner"); dfs.columns = ["asia", "lon", "ny"]; dfs["asia_next"] = dfs["asia"].shift(-1)
def relay(a, b):
    j = dfs[[a, b]].dropna(); out = {}
    for per, lo_, hi_ in [("train", pd.Timestamp("2000-01-01", tz="UTC"), T1), ("val", T1, T2), ("final", T2, pd.Timestamp("2100-01-01", tz="UTC"))]:
        x = j[(j.index >= lo_) & (j.index < hi_)]
        c0 = np.corrcoef(x[a], x[b])[0, 1]; cnt = 0
        for _ in range(5000):
            if abs(np.corrcoef(x[a], rng.permutation(x[b].values))[0, 1]) >= abs(c0): cnt += 1
        out[per] = dict(n=int(len(x)), corr=float(c0), p=float((1 + cnt) / 5001))
    out["finding"] = verdict(out["train"]["p"], out["val"]["p"], out["final"]["p"], out["train"]["corr"], out["val"]["corr"], out["final"]["corr"], out["final"]["n"])
    return out
R["R1a_asia_to_london"] = relay("asia", "lon"); R["R1b_london_to_ny"] = relay("lon", "ny"); R["R1c_ny_to_next_asia"] = relay("ny", "asia_next")

# ---------------- X1 extreme timing vs surrogate ----------------
ret = np.log(h["close"] / h["open"]).values
days = [(d_, g.index.values) for d_, g in h.groupby("tday") if len(g) >= 22]
def first_half_share(paths):
    c = 0; n = 0
    for p_ in paths:
        n_ = len(p_); half = n_ // 2
        c += (np.argmax(p_) < half) + (np.argmin(p_) < half); n += 2
    return c / n
def build(order_fn):
    ps = []
    for d_, idx in days:
        r_ = ret[idx]; r_ = order_fn(r_); ps.append(np.cumsum(r_))
    return ps
X1 = {}
for per, lo_, hi_ in [("train", pd.Timestamp("2000-01-01", tz="UTC"), T1), ("val", T1, T2), ("final", T2, pd.Timestamp("2100-01-01", tz="UTC"))]:
    dd = [(d_, idx) for d_, idx in days if lo_ <= h.loc[idx[0], "utc"] < hi_]
    if len(dd) < 20: X1[per] = dict(n=len(dd), p=1.0, diff=0.0); continue
    real = first_half_share([np.cumsum(ret[idx]) for _, idx in dd])
    sur = []
    for _ in range(1000):
        sur.append(first_half_share([np.cumsum(rng.permutation(ret[idx])) for _, idx in dd]))
    sur = np.array(sur); diff = real - sur.mean()
    p = (1 + (np.abs(sur - sur.mean()) >= abs(diff)).sum()) / 1001
    X1[per] = dict(n_days=int(len(dd)), real_share_first_half=float(real), surrogate_share=float(sur.mean()), diff=float(diff), p=float(p))
X1["finding"] = verdict(X1["train"]["p"], X1["val"]["p"], X1["final"]["p"], X1["train"]["diff"], X1["val"]["diff"], X1["final"]["diff"], X1["final"].get("n_days", 0))
R["X1"] = X1
R["_meta"] = dict(bonferroni=BONF, cost_usd=COST, periods=dict(train="2021-05..2022-12", val="2023-01..2024-12", final="2025-01..2026-11"))
def js(o):
    if isinstance(o, np.floating): return float(o)
    if isinstance(o, np.integer): return int(o)
    if isinstance(o, np.bool_): return bool(o)
    return str(o)
json.dump(R, open("../reports/lab03_results.json", "w"), indent=1, default=js)
print(json.dumps(R, indent=1, default=js))
