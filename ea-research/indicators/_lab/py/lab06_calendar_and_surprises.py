"""AT24 Research Lab 06 - calendar effects and data surprises on gold.

PRE-REGISTRATION (written 2026-11-11 BEFORE any result of this script was seen; XAUUSD, one broker feed; D1 bars from 2017-10, H1 bars from 2021-05-05,
USD calendar from 2023; cost not modelled, effects are tested as mean differences / correlations).

  T1  Turn of the month. D1 close-to-close log returns (bp). "Turn" days = the last trading day of a calendar month and the first three trading days of the
      next. Test: mean return on turn days MINUS other days, permutation test (labels shuffled).
  T2  Hawkish surprises hurt gold. High-importance USD releases where higher = USD-positive: Nonfarm Payrolls, Average Hourly Earnings m/m, CPI m/m,
      CPI y/y, Core CPI m/m, Core PCE Price Index m/m, Retail Sales m/m, ISM Manufacturing PMI, ISM Non-Manufacturing PMI, GDP q/q. Surprise z = (actual -
      forecast) / standard deviation of that release's surprises (events with both values). Reaction = log(close of the H1 bar after the bar containing the
      release / open of the bar containing the release), in bp. Test: Spearman correlation between z and reaction (expected NEGATIVE), permutation p, two-sided.
  T3  The weekend gap is faded. D1 bars: Monday open versus Friday close (Monday bar immediately after a Friday bar). Fade return = (Monday close - Monday open)
      in the direction AGAINST the gap, in bp. Test: mean fade return > 0, sign-flip permutation test (two-sided).
  Family of 3, Bonferroni alpha = 0.05 / 3 = 0.0167. Periods: train (start..2021-12-31 for D1; ..2023-12-31 for the H1/calendar test), validation
  (2022-01-01..2024-06-30 for D1; 2024-01-01..2025-06-30 for T2), final (2024-07-01.. for D1; 2025-07-01.. for T2).
  FINDING only if p_train < alpha AND same sign with p_val < 0.05 AND same sign in final (p_final < 0.10 or fewer than 30 events in final).
Seeds fixed. Results are reported whatever they are.
"""
import sys, json
import numpy as np, pandas as pd
from scipy import stats
rng = np.random.default_rng(20261114)
D = sys.argv[1] if len(sys.argv) > 1 else "E:/at24_lab_data"
BONF = 0.05 / 3
def verdict(pt, pv, pf, st, sv, sf, nf):
    return bool(pt < BONF and pv < 0.05 and st * sv > 0 and st * sf > 0 and (pf < 0.10 or nf < 30))
def perm_diff(a, b, k=10000):
    a, b = np.asarray(a, float), np.asarray(b, float); d0 = a.mean() - b.mean(); pool = np.concatenate([a, b]); cn = 0
    for _ in range(k):
        rng.shuffle(pool)
        if abs(pool[:len(a)].mean() - pool[len(a):].mean()) >= abs(d0): cn += 1
    return float(d0), float((1 + cn) / (k + 1))
R = {}
# ---------------- D1 data ----------------
d = pd.read_csv(f"{D}/lab_xauusd_d1.csv"); d["date"] = pd.to_datetime(d["time"], unit="s").dt.normalize(); d = d[d["close"] > 0].reset_index(drop=True)
d["ret"] = 1e4 * np.log(d["close"] / d["close"].shift(1))
D1, D2 = pd.Timestamp("2022-01-01"), pd.Timestamp("2024-07-01")
d["period"] = np.where(d["date"] < D1, "train", np.where(d["date"] < D2, "val", "final"))
# T1 turn of the month
d["ym"] = d["date"].dt.to_period("M"); d["rank_in_month"] = d.groupby("ym").cumcount(); d["rank_from_end"] = d.groupby("ym").cumcount(ascending=False)
d["turn"] = (d["rank_from_end"] == 0) | (d["rank_in_month"] <= 2)
dd = d.dropna(subset=["ret"]); T1r = {}
for per in ["train", "val", "final"]:
    x = dd[dd["period"] == per]; a, b = x[x["turn"]]["ret"], x[~x["turn"]]["ret"]
    d0, p0 = perm_diff(a, b); T1r[per] = dict(n_turn=int(len(a)), n_other=int(len(b)), mean_turn=float(a.mean()), mean_other=float(b.mean()), diff=d0, p=p0)
T1r["finding"] = verdict(T1r["train"]["p"], T1r["val"]["p"], T1r["final"]["p"], T1r["train"]["diff"], T1r["val"]["diff"], T1r["final"]["diff"], T1r["final"]["n_turn"])
R["T1"] = T1r
# T3 weekend gap fade
d["prev_date"] = d["date"].shift(1); d["prev_close"] = d["close"].shift(1)
mon = d[(d["date"].dt.weekday == 0) & (d["prev_date"].dt.weekday == 4) & ((d["date"] - d["prev_date"]).dt.days <= 3)].copy()
mon["gap"] = 1e4 * np.log(mon["open"] / mon["prev_close"]); mon = mon[mon["gap"] != 0]
mon["fade"] = -np.sign(mon["gap"]) * 1e4 * np.log(mon["close"] / mon["open"]); T3r = {}
for per in ["train", "val", "final"]:
    f = mon[mon["period"] == per]["fade"].values
    if len(f) < 8: T3r[per] = dict(n=int(len(f)), mean_fade=0.0, diff=0.0, p=1.0, note="not testable: this broker stored a Sunday D1 bar until mid-2022, so no Monday bar follows a Friday bar"); continue
    m0 = f.mean(); cn = 0
    for _ in range(10000):
        s = rng.choice([-1.0, 1.0], size=len(f))
        if abs((s * f).mean()) >= abs(m0): cn += 1
    T3r[per] = dict(n=int(len(f)), mean_fade=float(m0), diff=float(m0), p=float((1 + cn) / 10001), mean_abs_gap=float(mon[mon["period"] == per]["gap"].abs().mean()))
T3r["finding"] = verdict(T3r["train"]["p"], T3r["val"]["p"], T3r["final"]["p"], T3r["train"]["diff"], T3r["val"]["diff"], T3r["final"]["diff"], T3r["final"]["n"])
R["T3"] = T3r
# ---------------- T2 surprises ----------------
h = pd.read_csv(f"{D}/lab_xauusd_h1.csv"); h["utc"] = pd.to_datetime(h["gmt"], unit="s", utc=True)
h["hbar"] = h["utc"].dt.floor("h"); hb = h.set_index("hbar")
ev = pd.read_csv(f"{D}/lab_usd_events.csv"); ev["utc"] = pd.to_datetime(ev["gmt"], unit="s", utc=True)
names = ["Nonfarm Payrolls", "Average Hourly Earnings m/m", "CPI m/m", "CPI y/y", "Core CPI m/m", "Core PCE Price Index m/m", "Retail Sales m/m", "ISM Manufacturing PMI", "ISM Non-Manufacturing PMI", "GDP q/q"]
ev = ev[(ev["importance"] == 3) & ev["name"].isin(names)].dropna(subset=["actual", "forecast"]).copy()
ev["surp"] = ev["actual"] - ev["forecast"]; ev["z"] = ev.groupby("name")["surp"].transform(lambda s: s / s.std() if s.std() > 0 else 0.0)
rows = []
for _, e in ev.iterrows():
    b0 = e["utc"].floor("h"); b1 = b0 + pd.Timedelta(hours=1)
    if b0 in hb.index and b1 in hb.index and e["z"] != 0:
        rows.append(dict(utc=e["utc"], z=e["z"], react=1e4 * np.log(hb.loc[b1, "close"] / hb.loc[b0, "open"])))
ev2 = pd.DataFrame(rows); E1, E2 = pd.Timestamp("2024-01-01", tz="UTC"), pd.Timestamp("2025-07-01", tz="UTC")
ev2["period"] = np.where(ev2["utc"] < E1, "train", np.where(ev2["utc"] < E2, "val", "final")); T2r = {}
for per in ["train", "val", "final"]:
    x = ev2[ev2["period"] == per]
    if len(x) < 8: T2r[per] = dict(n=int(len(x)), corr=0.0, diff=0.0, p=1.0); continue
    c0 = float(stats.spearmanr(x["z"], x["react"]).statistic); cn = 0
    for _ in range(5000):
        if abs(stats.spearmanr(x["z"], rng.permutation(x["react"].values)).statistic) >= abs(c0): cn += 1
    T2r[per] = dict(n=int(len(x)), corr=c0, diff=c0, p=float((1 + cn) / 5001))
T2r["finding"] = verdict(T2r["train"]["p"], T2r["val"]["p"], T2r["final"]["p"], T2r["train"]["diff"], T2r["val"]["diff"], T2r["final"]["diff"], T2r["final"]["n"])
T2r["n_total"] = int(len(ev2)); R["T2"] = T2r
# ---------------- T3x (POST-HOC, not part of the pre-registered family, not counted in the verdict) ----------------
# First D1 bar after each Friday bar, whatever weekday it carries (the broker's Sunday bar until 2022-06 is a partial session).
d["gap_wd"] = (d["date"].shift(1).dt.weekday == 4)
fx = d[d["gap_wd"] & (d["date"] > d["date"].shift(1))].copy(); fx["gap"] = 1e4 * np.log(fx["open"] / fx["prev_close"]); fx = fx[fx["gap"] != 0]
fx["fade"] = -np.sign(fx["gap"]) * 1e4 * np.log(fx["close"] / fx["open"]); T3x = {}
for per in ["train", "val", "final"]:
    f = fx[fx["period"] == per]["fade"].values; m0 = f.mean(); cn = 0
    for _ in range(10000):
        sg = rng.choice([-1.0, 1.0], size=len(f))
        if abs((sg * f).mean()) >= abs(m0): cn += 1
    T3x[per] = dict(n=int(len(f)), mean_fade=float(m0), p=float((1 + cn) / 10001), mean_abs_gap=float(fx[fx["period"] == per]["gap"].abs().mean()))
R["T3x_posthoc"] = T3x
json.dump(R, open(sys.argv[2] if len(sys.argv) > 2 else "lab06_results.json", "w"), indent=1)
for k in ["T1", "T2", "T3", "T3x_posthoc"]: print(k, json.dumps(R[k]))
