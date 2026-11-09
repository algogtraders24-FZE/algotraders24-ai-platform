"""AT24 Research Lab 01 (v2) - nine pre-registered hypotheses on XAUUSD, with proper nulls and an untouched holdout.

DATA AUDIT NOTE (found after a first run, which is SUPERSEDED): the broker H1 history before 2021-04 is NOT hourly (only two bars per day, NY hours 15 and 17)
and bars carry spread 0 until 2023. v2 therefore uses H1 only from the first day with full 24 h coverage; daily-level tests use D1 (complete since 2017).
The hypotheses, thresholds and decision rule below are unchanged from v1; only the valid data window changed.

PRE-REGISTRATION (written BEFORE any result was looked at):
  Data: XAUUSD H1 (first full-coverage day 2021-04 .. 2026-11, Equiti server feed), D1 (2017-10 ..), USD economic calendar (2023+).
  Split: TRAIN = before 2023-01-01, HOLDOUT = 2023-01-01 and later. Calendar tests (H4, H5) exist only 2023+ (single shot).
  Family-wise alpha = 0.05 over 9 hypotheses -> Bonferroni threshold 0.0056.
  A hypothesis is a FINDING only if: p_train < 0.0056 AND the holdout shows the same sign with p_holdout < 0.05.
  Calendar tests (H4, H5): finding only if p < 0.0056.
  Nothing is added or dropped after seeing results.
Hypotheses:
  H1 hour-of-day drift: some New York hour has non-zero mean return (statistic: max |t| over hours; null: shuffle bars within trading day).
  H2 net of spread: the best H1 hour's mean return exceeds its average spread cost (descriptive, only if H1 is a finding).
  H3 intraday momentum: the return of NY hour 8 predicts the return of NY hour 15 (day-level correlation; null: permute days).
  H4 pre-event drift: the 2 h before high-impact USD events differ from the same clock hours on days without events.
  H5 post-event momentum: the direction of the event-hour move predicts the next 3 hours.
  H6 spike behaviour: after an H1 bar of >= 2.5 ATR, the next 4 hours continue (or reverse) the spike more often than chance.
  H7 volatility-regime drift: mean H1 return differs between high and low trailing-volatility regimes (top vs bottom tercile of 20-day realised vol).
  H8 turn of the month: returns of the last 2 + first 3 trading days of a month differ from other days.
  H9 weekend gap direction: the direction of a weekend gap predicts the next 4 hours.
"""
import sys, json, math
import numpy as np, pandas as pd
from zoneinfo import ZoneInfo

rng = np.random.default_rng(20261109)
NY = ZoneInfo("America/New_York")
SPLIT = pd.Timestamp("2023-01-01", tz="UTC")
ALPHA = 0.05 / 9
D = sys.argv[1] if len(sys.argv) > 1 else "../data"

def load(name):
    df = pd.read_csv(f"{D}/{name}")
    df["utc"] = pd.to_datetime(df["gmt"], unit="s", utc=True)
    df["ny"] = df["utc"].dt.tz_convert(NY)
    return df

h1 = load("lab_xauusd_h1.csv")
d1 = pd.read_csv(f"{D}/lab_xauusd_d1.csv"); d1["utc"] = pd.to_datetime(d1["time"], unit="s", utc=True)
ev = pd.read_csv(f"{D}/lab_usd_events.csv"); ev["utc"] = pd.to_datetime(ev["gmt"], unit="s", utc=True)
h1["ret"] = np.log(h1["close"] / h1["open"])
h1["hour"] = h1["ny"].dt.hour
# trading day: the New York day that starts at 18:00 (so 18..23 belong to the next calendar date)
h1["tday"] = (h1["ny"] + pd.Timedelta(hours=6)).dt.date
h1["dayid"] = pd.factorize(h1["tday"])[0]
_cov = h1.groupby("tday")["hour"].nunique()
START_DAY = _cov[_cov >= 22].index[0]
h1 = h1[h1["tday"] >= START_DAY].reset_index(drop=True)
h1["dayid"] = pd.factorize(h1["tday"])[0]
h1["train"] = h1["utc"] < SPLIT
out = {"n_h1": int(len(h1)), "first": str(h1["utc"].iloc[0]), "last": str(h1["utc"].iloc[-1]), "n_train": int(h1["train"].sum()), "n_holdout": int((~h1["train"]).sum())}
print(json.dumps(out)); R = {}

def hour_t(ret, hour):
    m = np.zeros(24); t = np.zeros(24); c = np.bincount(hour, minlength=24)
    s = np.bincount(hour, weights=ret, minlength=24); s2 = np.bincount(hour, weights=ret * ret, minlength=24)
    ok = c > 30
    mean = np.where(ok, s / np.maximum(c, 1), 0.0)
    var = np.where(ok, (s2 - c * mean ** 2) / np.maximum(c - 1, 1), 1.0)
    t = np.where(ok, mean / np.sqrt(var / np.maximum(c, 1)), 0.0)
    return mean, t, c

def shuffle_within_day(ret, dayid):
    order = np.argsort(dayid + rng.random(len(dayid)) * 0.99, kind="stable")
    return ret[order]

# ---------------- H1 / H2 ----------------
tr = h1[h1["train"]]; ho = h1[~h1["train"]]
mean_tr, t_tr, c_tr = hour_t(tr["ret"].values, tr["hour"].values)
obs = np.abs(t_tr).max(); best = int(np.abs(t_tr).argmax())
null = np.empty(2000)
rt, hr, di = tr["ret"].values, tr["hour"].values, tr["dayid"].values
for i in range(2000):
    null[i] = np.abs(hour_t(shuffle_within_day(rt, di), hr)[1]).max()
p_tr = (1 + (null >= obs).sum()) / 2001
mean_ho, t_ho, c_ho = hour_t(ho["ret"].values, ho["hour"].values)
p_ho = 2 * (1 - __import__("scipy.stats", fromlist=["norm"]).norm.cdf(abs(t_ho[best])))
R["H1"] = dict(best_hour=best, mean_bp_train=float(mean_tr[best] * 1e4), t_train=float(t_tr[best]), p_train_maxT=float(p_tr), mean_bp_holdout=float(mean_ho[best] * 1e4), t_holdout=float(t_ho[best]), p_holdout=float(p_ho),
               same_sign=bool(np.sign(mean_tr[best]) == np.sign(mean_ho[best])), finding=bool(p_tr < ALPHA and p_ho < 0.05 and np.sign(mean_tr[best]) == np.sign(mean_ho[best])),
               hours_train_mean_bp=[round(float(x * 1e4), 2) for x in mean_tr], hours_train_t=[round(float(x), 2) for x in t_tr], hours_holdout_mean_bp=[round(float(x * 1e4), 2) for x in mean_ho], hours_holdout_t=[round(float(x), 2) for x in t_ho])
# H2: spread cost (spread is in points of 0.01 USD) as fraction of price, round trip = one spread paid
sel = h1[h1["hour"] == best]
cost_bp = float((sel["spread"] * 0.01 / sel["open"]).mean() * 1e4)
net_ho_bp = float(mean_ho[best] * 1e4 * np.sign(mean_tr[best]) - cost_bp)
R["H2"] = dict(hour=best, avg_spread_points=float(sel["spread"].mean()), cost_bp=cost_bp, gross_bp_holdout_in_train_direction=float(mean_ho[best] * 1e4 * np.sign(mean_tr[best])), net_bp_holdout=net_ho_bp, evaluated_even_if_not_finding=True)

# ---------------- H3 intraday momentum ----------------
def pair_days(hour_a, hour_b):
    a = h1[h1["hour"] == hour_a].groupby("tday")["ret"].sum(); b = h1[h1["hour"] == hour_b].groupby("tday")["ret"].sum()
    j = pd.concat([a, b], axis=1, join="inner"); j.columns = ["a", "b"]
    j.index = pd.to_datetime(j.index).tz_localize("UTC")
    return j
j = pair_days(8, 15)
def corr_perm(x, y, n=5000):
    c0 = np.corrcoef(x, y)[0, 1]; cnt = 0
    for _ in range(n):
        if abs(np.corrcoef(x, rng.permutation(y))[0, 1]) >= abs(c0): cnt += 1
    return c0, (1 + cnt) / (n + 1)
jt, jh = j[j.index < SPLIT], j[j.index >= SPLIT]
c_tr3, p_tr3 = corr_perm(jt["a"].values, jt["b"].values); c_ho3, p_ho3 = corr_perm(jh["a"].values, jh["b"].values)
R["H3"] = dict(days_train=int(len(jt)), corr_train=float(c_tr3), p_train=float(p_tr3), days_holdout=int(len(jh)), corr_holdout=float(c_ho3), p_holdout=float(p_ho3),
               finding=bool(p_tr3 < ALPHA and p_ho3 < 0.05 and np.sign(c_tr3) == np.sign(c_ho3)))

# ---------------- H4 / H5 calendar ----------------
e3 = ev[(ev["importance"] == 3)].copy()
e_any = ev["utc"].values
h1i = h1.set_index("utc")
hour_start = lambda t: t.floor("h")
def window_ret(t0, hours):  # sum of H1 returns for bars starting at t0 .. t0+hours-1
    idx = [t0 + pd.Timedelta(hours=k) for k in range(hours)]
    s = h1i["ret"].reindex(idx)
    return float(s.sum()) if s.notna().all() else np.nan
pre, post_first, post_next = [], [], []
event_days = set()
for t in e3["utc"]:
    hs = hour_start(t)
    pre.append((hs.hour, window_ret(hs - pd.Timedelta(hours=2), 2)))
    f = window_ret(hs, 1); n3 = window_ret(hs + pd.Timedelta(hours=1), 3)
    if not (np.isnan(f) or np.isnan(n3)): post_first.append(f); post_next.append(n3)
    event_days.add(t.floor("D"))
pre_df = pd.DataFrame(pre, columns=["hour", "ret"]).dropna()
# control: same clock hour, on days with no importance>=2 event within the 2h-pre window... simplified: days with no imp-3 event at all
ev_hours = set(e3["utc"].dt.floor("h"))
ctrl = []
for hh in sorted(pre_df["hour"].unique()):
    days = h1i[(h1i.index.hour == hh) & (h1i.index >= pd.Timestamp("2023-01-01", tz="UTC"))].index.floor("D").unique()
    for dday in days:
        if dday in event_days: continue
        t0 = dday + pd.Timedelta(hours=int(hh)) - pd.Timedelta(hours=2)
        v = window_ret(t0, 2)
        if not np.isnan(v): ctrl.append((hh, v))
ctrl_df = pd.DataFrame(ctrl, columns=["hour", "ret"])
x = pre_df["ret"].values; y = ctrl_df["ret"].values
diff0 = x.mean() - y.mean(); allv = np.concatenate([x, y]); cnt = 0
for _ in range(5000):
    rng.shuffle(allv)
    if abs(allv[:len(x)].mean() - allv[len(x):].mean()) >= abs(diff0): cnt += 1
R["H4"] = dict(n_events=int(len(x)), n_control=int(len(y)), mean_event_bp=float(x.mean() * 1e4), mean_control_bp=float(y.mean() * 1e4), diff_bp=float(diff0 * 1e4), p=float((1 + cnt) / 5001), finding=bool((1 + cnt) / 5001 < ALPHA))
f = np.array(post_first); n3 = np.array(post_next); mask = f != 0
same = (np.sign(f[mask]) == np.sign(n3[mask])); k = int(same.sum()); n = int(mask.sum())
from scipy.stats import binomtest
bt = binomtest(k, n, 0.5)
R["H5"] = dict(n=n, same_direction=k, rate=float(k / n), p=float(bt.pvalue), corr=float(np.corrcoef(f, n3)[0, 1]), finding=bool(bt.pvalue < ALPHA))

# ---------------- H6 spikes ----------------
tr_ = np.maximum.reduce([h1["high"] - h1["low"], (h1["high"] - h1["close"].shift()).abs(), (h1["low"] - h1["close"].shift()).abs()])
atr = pd.Series(tr_).ewm(alpha=1 / 14, adjust=False).mean().shift(1)
body = h1["close"] - h1["open"]
spike = (body.abs() >= 2.5 * atr).values
fwd = (h1["close"].shift(-4) - h1["close"]).values
valid = spike & ~np.isnan(fwd) & (body.values != 0)
def spike_stats(mask_period):
    m = valid & mask_period
    cont = (np.sign(fwd[m]) == np.sign(body.values[m])); k = int(cont.sum()); n = int(m.sum())
    base_up = float(np.nanmean(fwd[mask_period] > 0))
    # baseline: probability that a random bar's next-4h move has the sign of an up (resp. down) spike
    exp = np.where(body.values[m] > 0, base_up, 1 - base_up).mean()
    # exact test against the expected continuation rate
    bt = binomtest(k, n, float(exp))
    return dict(n=n, continued=k, rate=float(k / n) if n else None, baseline_rate=float(exp), p=float(bt.pvalue))
tr_mask = h1["train"].values
R["H6"] = dict(train=spike_stats(tr_mask), holdout=spike_stats(~tr_mask))
R["H6"]["finding"] = bool(R["H6"]["train"]["p"] < ALPHA and R["H6"]["holdout"]["p"] < 0.05 and np.sign(R["H6"]["train"]["rate"] - R["H6"]["train"]["baseline_rate"]) == np.sign(R["H6"]["holdout"]["rate"] - R["H6"]["holdout"]["baseline_rate"]))

# ---------------- H7 vol regime (daily candles, range-based volatility, complete since 2017) ----------------
d1v = pd.read_csv(f"{D}/lab_xauusd_d1.csv"); d1v["utc"] = pd.to_datetime(d1v["time"], unit="s", utc=True)
d1v = d1v[d1v["utc"].dt.dayofweek < 5].reset_index(drop=True)
d1v["ret"] = np.log(d1v["close"] / d1v["open"]); d1v["rv"] = (d1v["high"] - d1v["low"]) / d1v["open"]
d1v["rv20"] = d1v["rv"].rolling(20).mean().shift(1)
dayret = d1v.dropna(subset=["rv20"]).copy(); dayret.index = pd.to_datetime(dayret["utc"].dt.date)
def vol_regime(df):
    q1, q2 = df["rv20"].quantile([1 / 3, 2 / 3])
    lo = df[df["rv20"] <= q1]["ret"].values; hi = df[df["rv20"] >= q2]["ret"].values
    d0 = hi.mean() - lo.mean(); allv = np.concatenate([hi, lo]); cnt = 0
    for _ in range(5000):
        rng.shuffle(allv)
        if abs(allv[:len(hi)].mean() - allv[len(hi):].mean()) >= abs(d0): cnt += 1
    return dict(n_high=int(len(hi)), n_low=int(len(lo)), mean_high_bp=float(hi.mean() * 1e4), mean_low_bp=float(lo.mean() * 1e4), diff_bp=float(d0 * 1e4), p=float((1 + cnt) / 5001))
vt = vol_regime(dayret[dayret.index < pd.Timestamp("2023-01-01")]); vh = vol_regime(dayret[dayret.index >= pd.Timestamp("2023-01-01")])
R["H7"] = dict(train=vt, holdout=vh, finding=bool(vt["p"] < ALPHA and vh["p"] < 0.05 and np.sign(vt["diff_bp"]) == np.sign(vh["diff_bp"])))

# ---------------- H8 turn of month ----------------
d1["date"] = pd.to_datetime(d1["utc"].dt.date); d1["ret"] = np.log(d1["close"] / d1["open"])
d1 = d1[d1["date"].dt.dayofweek < 5].copy()
d1["ym"] = d1["date"].dt.to_period("M")
d1["pos_from_start"] = d1.groupby("ym").cumcount(); d1["pos_from_end"] = d1.groupby("ym")["date"].transform("count") - 1 - d1["pos_from_start"]
d1["tom"] = (d1["pos_from_start"] < 3) | (d1["pos_from_end"] < 2)
def tom_test(df):
    a = df[df["tom"]]["ret"].values; b = df[~df["tom"]]["ret"].values
    d0 = a.mean() - b.mean(); allv = np.concatenate([a, b]); cnt = 0
    for _ in range(10000):
        rng.shuffle(allv)
        if abs(allv[:len(a)].mean() - allv[len(a):].mean()) >= abs(d0): cnt += 1
    return dict(n_tom=int(len(a)), n_other=int(len(b)), mean_tom_bp=float(a.mean() * 1e4), mean_other_bp=float(b.mean() * 1e4), diff_bp=float(d0 * 1e4), p=float((1 + cnt) / 10001))
tt = tom_test(d1[d1["date"] < pd.Timestamp("2023-01-01")]); th = tom_test(d1[d1["date"] >= pd.Timestamp("2023-01-01")])
R["H8"] = dict(train=tt, holdout=th, finding=bool(tt["p"] < ALPHA and th["p"] < 0.05 and np.sign(tt["diff_bp"]) == np.sign(th["diff_bp"])))

# ---------------- H9 weekend gap direction ----------------
t = h1["utc"].values.astype("datetime64[s]").astype(np.int64)
gapidx = np.where((np.diff(t) > 12 * 3600))[0] + 1
gl = []
for i in gapidx:
    if i < 20 or i + 4 >= len(h1) or np.isnan(atr.iloc[i - 1]): continue
    size = h1["open"].iloc[i] - h1["close"].iloc[i - 1]
    if abs(size) < 0.1 * atr.iloc[i - 1]: continue
    mv = h1["close"].iloc[i + 3] - h1["open"].iloc[i]
    gl.append((h1["utc"].iloc[i], size, mv))
gdf = pd.DataFrame(gl, columns=["t", "size", "mv"]); gdf = gdf[gdf["mv"] != 0]
def gap_dir(df):
    k = int((np.sign(df["size"]) == np.sign(df["mv"])).sum()); n = len(df)
    bt = binomtest(k, n, 0.5)
    return dict(n=int(n), same_direction=k, rate=float(k / n), p=float(bt.pvalue))
gt = gap_dir(gdf[gdf["t"] < SPLIT]); gh = gap_dir(gdf[gdf["t"] >= SPLIT])
R["H9"] = dict(train=gt, holdout=gh, finding=bool(gt["p"] < ALPHA and gh["p"] < 0.05 and (gt["rate"] - 0.5) * (gh["rate"] - 0.5) > 0))

R["_meta"] = dict(alpha_family=0.05, bonferroni=ALPHA, split=str(SPLIT), data=out)
print(json.dumps(R, indent=1, default=lambda o: float(o) if isinstance(o, (np.floating,)) else (int(o) if isinstance(o, np.integer) else str(o))))
json.dump(R, open("lab01_results.json", "w"), indent=1, default=lambda o: float(o) if isinstance(o, np.floating) else (int(o) if isinstance(o, np.integer) else (bool(o) if isinstance(o, np.bool_) else str(o))))
