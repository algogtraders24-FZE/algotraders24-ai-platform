"""AT24 Research Lab 02 (v2) - five ORIGINAL / out-of-the-box hypotheses plus a persistence meta-test, pre-registered.

Why a second lab: Lab 01 (nine textbook ideas) produced no finding. Lab 02 asks questions we have not seen tested on gold,
and one meta-question that matters for every indicator we sell: "do the effects we find actually persist?".

DATA AUDIT NOTE (found after a first run, which is SUPERSEDED): broker H1 history is only hourly from 2021-04 (before that: two bars per day) and the bar
spread field is 0 until 2023 and trustworthy from 2024. v2 uses H1 only from the first full-coverage day, the spread test only from 2024-01, and D1 (complete since 2017)
for the daily tests. Hypotheses and the decision rule are unchanged; periods were re-cut accordingly (below).

PRE-REGISTRATION (written before any result below was looked at):
  Data: XAUUSD H1 / D1, Equiti server feed, 2017-10 .. 2026-11.
  Periods: daily tests TRAIN 2017-10..2021-12 / VALIDATION 2022-01..2024-12 / FINAL 2025-01..2026-11; intraday tests (full coverage) TRAIN 2021-04..2022-12 / VALIDATION 2023-01..2024-12 / FINAL 2025-01..2026-11; spread test TRAIN 2024-01..2025-03 / VALIDATION 2025-04..2025-12 / FINAL 2026-01..2026-11.
  Family-wise alpha 0.05 over 5 hypotheses -> Bonferroni 0.01 (the persistence meta-test is reported separately, alpha 0.05).
  FINDING = p_train < 0.01 AND same sign with p_validation < 0.05 AND same sign in FINAL (p < 0.10, or sign only if n < 30).
  Hypotheses:
   O1 spread as a signal (2024+ only): a wider-than-usual spread (for that New York hour) predicts a larger-than-usual range in the NEXT hour.
   O2 time-series momentum on gold: the sign of the trailing 63-day return predicts the next 21-day return (difference of means).
   O3 scale alignment: when the sign of the last 1 h, 4 h, 24 h and 120 h returns all agree, the next 24 h continues in that direction more than chance.
   O4 stretch behaviour: if by 12:00 New York the day's range already reached 100 % of its expected (mean of the previous 14 days) range, the rest of the day
      continues the day's direction at a different rate than on other days.
   O5 reopening premium: the first hour after the daily break (NY 18:00) has a positive mean return, in every period (descriptive discovery from Lab 01).
  Meta-test M1: for each 12-month window (step 3 months, from 2021-04) pick the New York hour with the largest |t|; does its sign and size persist into the next 6 months?
"""
import sys, json, math
import numpy as np, pandas as pd
from scipy import stats
from zoneinfo import ZoneInfo
rng = np.random.default_rng(20261110)
NY = ZoneInfo("America/New_York"); D = sys.argv[1] if len(sys.argv) > 1 else "../data"
T1, T2 = pd.Timestamp("2022-01-01", tz="UTC"), pd.Timestamp("2025-01-01", tz="UTC")
BONF = 0.05 / 5

h1 = pd.read_csv(f"{D}/lab_xauusd_h1.csv"); h1["utc"] = pd.to_datetime(h1["gmt"], unit="s", utc=True); h1["ny"] = h1["utc"].dt.tz_convert(NY)
h1["hour"] = h1["ny"].dt.hour; h1["ret"] = np.log(h1["close"] / h1["open"]); h1["tday"] = (h1["ny"] + pd.Timedelta(hours=6)).dt.date
_cov = h1.groupby("tday")["hour"].nunique()
h1 = h1[h1["tday"] >= _cov[_cov >= 22].index[0]].reset_index(drop=True)
h1["period"] = np.where(h1["utc"] < pd.Timestamp("2023-01-01", tz="UTC"), "train", np.where(h1["utc"] < T2, "val", "final"))
d1 = pd.read_csv(f"{D}/lab_xauusd_d1.csv"); d1["utc"] = pd.to_datetime(d1["time"], unit="s", utc=True)
d1 = d1[d1["utc"].dt.dayofweek < 5].reset_index(drop=True); d1["ret"] = np.log(d1["close"] / d1["open"])
d1["period"] = np.where(d1["utc"] < T1, "train", np.where(d1["utc"] < T2, "val", "final"))
R = {}

def shift_null(stat_fn, x, y, n=3000, minshift=50):
    """circular-shift null: shifts y against x by a random lag, which keeps both autocorrelation structures but breaks the link."""
    obs = stat_fn(x, y); N = len(x); cnt = 0
    for _ in range(n):
        k = int(rng.integers(minshift, N - minshift))
        if abs(stat_fn(x, np.roll(y, k))) >= abs(obs): cnt += 1
    return obs, (1 + cnt) / (n + 1)

def verdict(res, pt, pv, pf, s_t, s_v, s_f, nfinal=100):
    same = (s_t * s_v > 0) and (s_t * s_f > 0)
    return bool(res and pt < BONF and pv < 0.05 and same and (pf < 0.10 or nfinal < 30))

# ---- O1 spread signal (spread field trustworthy from 2024) ----
sp = h1[h1["utc"] >= pd.Timestamp("2024-01-01", tz="UTC")].copy().reset_index(drop=True)
sp["period"] = np.where(sp["utc"] < pd.Timestamp("2025-04-01", tz="UTC"), "train", np.where(sp["utc"] < pd.Timestamp("2026-01-01", tz="UTC"), "val", "final"))
sp = sp[sp["spread"] > 0].reset_index(drop=True)
med_sp = sp[sp["period"] == "train"].groupby("hour")["spread"].median()
rng_rel = (sp["high"] - sp["low"]) / sp["open"]
med_rg = rng_rel[sp["period"] == "train"].groupby(sp["hour"][sp["period"] == "train"]).median()
sp["spz"] = np.log(sp["spread"] / sp["hour"].map(med_sp))
sp["rgz"] = np.log(np.maximum(rng_rel, 1e-9) / sp["hour"].map(med_rg))
nxt = sp["rgz"].shift(-1); contiguous = (sp["utc"].shift(-1) - sp["utc"]) == pd.Timedelta(hours=1)
use = nxt.notna() & contiguous & sp["spz"].notna()
def slope(x, y):
    x = x - x.mean(); return float((x * (y - y.mean())).sum() / (x * x).sum())
O1 = {}
for per in ["train", "val", "final"]:
    m = use & (sp["period"] == per)
    x = sp.loc[m, "spz"].values; y = nxt[m].values
    s_, p_ = shift_null(slope, x, y, n=1500)
    O1[per] = dict(n=int(m.sum()), slope=float(s_), corr=float(np.corrcoef(x, y)[0, 1]), p=float(p_))
O1["finding"] = verdict(True, O1["train"]["p"], O1["val"]["p"], O1["final"]["p"], O1["train"]["slope"], O1["val"]["slope"], O1["final"]["slope"], O1["final"]["n"])
q = sp.loc[use, "spz"].quantile(0.9); hi = nxt[use & (sp["spz"] >= q)].mean(); lo = nxt[use & (sp["spz"] < q)].mean()
O1["practical"] = dict(top10pct_spread_next_hour_range_vs_norm=float(np.exp(hi)), others=float(np.exp(lo)))
R["O1"] = O1

# ---- O2 time-series momentum ----
c = d1["close"].values; ret = d1["ret"].values; N = len(d1)
sig = np.array([np.sign(np.log(c[i] / c[i - 63])) if i >= 63 else 0 for i in range(N)])
fwd = np.array([np.log(c[i + 21] / c[i]) if i + 21 < N else np.nan for i in range(N)])
idx = np.arange(63, N - 21, 21)          # non-overlapping 21-day samples
O2 = {}
for per in ["train", "val", "final"]:
    sel = [i for i in idx if d1["period"].iloc[i] == per]
    s = sig[sel]; f = fwd[sel]
    pos, neg = f[s > 0], f[s < 0]
    diff = (pos.mean() - neg.mean()) if len(neg) > 2 else float("nan")
    def dstat(a, b):
        return a[a > 0].mean() if False else None
    # permutation: shuffle the signal labels
    cnt = 0; base = abs(diff) if not np.isnan(diff) else None
    if base is not None:
        for _ in range(5000):
            sp = rng.permutation(s)
            d = f[sp > 0].mean() - f[sp < 0].mean()
            if abs(d) >= base: cnt += 1
    O2[per] = dict(n=int(len(sel)), n_pos=int((s > 0).sum()), n_neg=int((s < 0).sum()), mean_after_up_pct=float(pos.mean() * 100) if len(pos) else None, mean_after_down_pct=float(neg.mean() * 100) if len(neg) else None,
                   diff_pct=None if np.isnan(diff) else float(diff * 100), p=None if base is None else float((1 + cnt) / 5001))
ok2 = all(O2[p]["p"] is not None for p in O2)
O2["finding"] = verdict(ok2, O2["train"]["p"] or 1, O2["val"]["p"] or 1, O2["final"]["p"] or 1, np.sign(O2["train"]["diff_pct"] or 0), np.sign(O2["val"]["diff_pct"] or 0), np.sign(O2["final"]["diff_pct"] or 0), O2["final"]["n"]) if ok2 else False
R["O2"] = O2

# ---- O3 scale alignment ----
cl = h1["close"].values; n = len(cl)
def lret(k):
    out = np.full(n, np.nan); out[k:] = np.log(cl[k:] / cl[:-k]); return out
S = np.sign(lret(1)) + np.sign(lret(4)) + np.sign(lret(24)) + np.sign(lret(120))
f24 = np.full(n, np.nan); f24[:-24] = np.log(cl[24:] / cl[:-24])
base_up = {p: float(np.nanmean(f24[h1["period"].values == p] > 0)) for p in ["train", "val", "final"]}
O3 = {}
for per in ["train", "val", "final"]:
    m = (h1["period"].values == per) & (np.abs(S) == 4) & ~np.isnan(f24)
    ids = np.where(m)[0]; keep = []; last = -999
    for i in ids:
        if i - last >= 24: keep.append(i); last = i
    keep = np.array(keep)
    if len(keep) == 0: O3[per] = dict(n=0); continue
    dirn = np.sign(S[keep]); cont = (np.sign(f24[keep]) == dirn); k = int(cont.sum()); nn = len(keep)
    exp = np.where(dirn > 0, base_up[per], 1 - base_up[per]).mean()
    O3[per] = dict(n=int(nn), continued=k, rate=float(k / nn), baseline_rate=float(exp), p=float(stats.binomtest(k, nn, float(exp)).pvalue))
O3["finding"] = verdict(all(O3[p].get("n", 0) > 0 for p in ["train", "val", "final"]), O3["train"]["p"], O3["val"]["p"], O3["final"]["p"], O3["train"]["rate"] - O3["train"]["baseline_rate"], O3["val"]["rate"] - O3["val"]["baseline_rate"], O3["final"]["rate"] - O3["final"]["baseline_rate"], O3["final"]["n"])
R["O3"] = O3

# ---- O4 stretch ----
rows = []
for tday, g in h1.groupby("tday"):
    g = g.sort_values("utc")
    pre = g[g["hour"].isin(list(range(18, 24)) + list(range(0, 12)))]
    at12 = g[g["hour"] == 12]
    if len(pre) < 14 or at12.empty: continue
    rows.append(dict(tday=pd.Timestamp(tday), start=g["open"].iloc[0], hi12=pre["high"].max(), lo12=pre["low"].min(), px12=float(at12["open"].iloc[0]), close=float(g["close"].iloc[-1]), full_rng=g["high"].max() - g["low"].min(), utc=g["utc"].iloc[0]))
dd = pd.DataFrame(rows); dd["exp14"] = dd["full_rng"].rolling(14).mean().shift(1)
dd = dd.dropna(); dd["so_far"] = dd["hi12"] - dd["lo12"]; dd["stretched"] = dd["so_far"] >= dd["exp14"]
dd["dir"] = np.sign(dd["px12"] - dd["start"]); dd["fwd"] = dd["close"] - dd["px12"]; dd = dd[(dd["dir"] != 0) & (dd["fwd"] != 0)]
dd["cont"] = np.sign(dd["fwd"]) == dd["dir"]
dd["period"] = np.where(dd["utc"] < T1, "train", np.where(dd["utc"] < T2, "val", "final"))
O4 = {}
for per in ["train", "val", "final"]:
    x = dd[dd["period"] == per]; a = x[x["stretched"]]["cont"]; b = x[~x["stretched"]]["cont"]
    if len(a) < 5 or len(b) < 5: O4[per] = dict(n_stretched=int(len(a)), n_other=int(len(b)), p=1.0, diff=0.0); continue
    tab = [[int(a.sum()), int((~a).sum())], [int(b.sum()), int((~b).sum())]]
    O4[per] = dict(n_stretched=int(len(a)), cont_stretched=float(a.mean()), n_other=int(len(b)), cont_other=float(b.mean()), diff=float(a.mean() - b.mean()), p=float(stats.fisher_exact(tab)[1]))
O4["finding"] = verdict(True, O4["train"]["p"], O4["val"]["p"], O4["final"]["p"], O4["train"]["diff"], O4["val"]["diff"], O4["final"]["diff"], O4["final"]["n_stretched"])
R["O4"] = O4

# ---- O5 reopening premium (NY 18) ----
O5 = {}
for per in ["train", "val", "final"]:
    x = h1[(h1["hour"] == 18) & (h1["period"] == per)]["ret"].values
    t = stats.ttest_1samp(x, 0.0)
    others = h1[(h1["hour"] != 18) & (h1["period"] == per)]["ret"].values
    O5[per] = dict(n=int(len(x)), mean_bp=float(x.mean() * 1e4), t=float(t.statistic), p=float(t.pvalue), up_pct=float((x > 0).mean() * 100), all_other_hours_mean_bp=float(others.mean() * 1e4))
O5["finding"] = bool(O5["train"]["p"] < BONF and O5["val"]["p"] < 0.05 and O5["final"]["p"] < 0.10 and O5["train"]["mean_bp"] > 0 and O5["val"]["mean_bp"] > 0 and O5["final"]["mean_bp"] > 0)
by_year = h1[h1["hour"] == 18].groupby(h1["utc"].dt.year)["ret"].agg(["mean", "std", "count"])
O5["by_year"] = {int(y): dict(mean_bp=float(r["mean"] * 1e4), t=float(r["mean"] / (r["std"] / math.sqrt(r["count"]))), n=int(r["count"])) for y, r in by_year.iterrows()}
R["O5"] = O5

# ---- M1 persistence of the best hour ----
res = []
t0 = h1["utc"].iloc[0].floor("D")
while t0 + pd.DateOffset(months=18) <= h1["utc"].iloc[-1]:
    a_ = h1[(h1["utc"] >= t0) & (h1["utc"] < t0 + pd.DateOffset(months=12))]; b_ = h1[(h1["utc"] >= t0 + pd.DateOffset(months=12)) & (h1["utc"] < t0 + pd.DateOffset(months=18))]
    ta = a_.groupby("hour")["ret"].agg(["mean", "std", "count"]); ta = ta[ta["count"] > 50]; ta["t"] = ta["mean"] / (ta["std"] / np.sqrt(ta["count"]))
    best = int(ta["t"].abs().idxmax()); sg = np.sign(ta.loc[best, "mean"])
    tb = b_[b_["hour"] == best]["ret"]; tt = float(tb.mean() / (tb.std() / math.sqrt(len(tb))))
    res.append(dict(start=str(t0.date()), best_hour=best, t_train=float(ta.loc[best, "t"]), mean_train_bp=float(ta.loc[best, "mean"] * 1e4), mean_test_in_train_dir_bp=float(tb.mean() * sg * 1e4), t_test_in_train_dir=tt * sg))
    t0 += pd.DateOffset(months=3)
mr = pd.DataFrame(res)
k = int((mr["mean_test_in_train_dir_bp"] > 0).sum()); n = len(mr)
R["M1"] = dict(windows=n, same_sign=k, rate=float(k / n), p_binom=float(stats.binomtest(k, n, 0.5).pvalue), mean_train_bp=float(mr["mean_train_bp"].abs().mean()), mean_test_in_train_dir_bp=float(mr["mean_test_in_train_dir_bp"].mean()),
               windows_detail=res, note="windows overlap heavily, so the binomial p-value is optimistic")
R["_meta"] = dict(bonferroni=BONF, periods=dict(train="2017-10..2021-12", val="2022-01..2024-12", final="2025-01..2026-11"))
def js(o):
    if isinstance(o, (np.floating,)): return float(o)
    if isinstance(o, (np.integer,)): return int(o)
    if isinstance(o, (np.bool_,)): return bool(o)
    return str(o)
json.dump(R, open("lab02_results.json", "w"), indent=1, default=js)
print(json.dumps(R, indent=1, default=js))
