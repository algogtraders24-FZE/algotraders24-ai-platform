"""AT24 Research Lab C2 - price-only structure of BTC (what a MT4/MT5 BTCUSD indicator could rely on).

PRE-REGISTRATION (written 2026-11-11 BEFORE any result was seen). Data: Binance spot BTCUSDT H1 (24/7), 2019-09..2026-11, UTC. Purely descriptive stability checks,
no trading rule, no edge claim. Three questions, each with a stability test between two non-overlapping periods (A 2020-2022, B 2023-2026):
  Q1 Is there a stable intraday range profile? Per UTC hour: median (high-low)/close. Spearman rank correlation between period A and B across the 24 hours,
     permutation p (hours shuffled), stable if rho > 0.7 and p < 0.01.
  Q2 Is the weekend calmer? Per day: range % (high-low of the UTC day)/close. Ratio of median weekend-day range to median weekday range, per year; stable if the
     ratio is below 1 in at least 6 of the 7 full years 2020-2026 (2026 partial).
  Q3 Do funding hours (00, 08, 16 UTC) carry a range bump? Ratio of the median H1 range at hours 0, 8, 16 to the median of the other hours, per year; stable if above 1 in
     at least 6 of 7 years.
Also reported, not tested: rolling 30-day realised volatility percentile distribution (how often BTC is in its calm / hot regime), and drawdown from the all-time high
(depth and duration of drawdowns, to see what a drawdown indicator would show).
"""
import sys, json
import numpy as np, pandas as pd
from scipy import stats
rng = np.random.default_rng(20261116)
f = sys.argv[1] if len(sys.argv) > 1 else "E:/at24_gd_portable/MQL5/Files/btc_h1.csv"
d = pd.read_csv(f, header=None, names=["t", "o", "h", "l", "c", "n"]); d["ts"] = pd.to_datetime(d["t"], unit="s"); d = d[d["ts"] >= "2020-01-01"].reset_index(drop=True)
d["rng"] = (d["h"] - d["l"]) / d["c"]; d["hr"] = d["ts"].dt.hour; d["yr"] = d["ts"].dt.year; d["wd"] = d["ts"].dt.weekday
R = {}
A = d[d["yr"] <= 2022]; B = d[d["yr"] >= 2023]
mA = A.groupby("hr")["rng"].median(); mB = B.groupby("hr")["rng"].median()
rho = stats.spearmanr(mA, mB).statistic; cn = sum(abs(stats.spearmanr(mA, rng.permutation(mB.values)).statistic) >= abs(rho) for _ in range(10000))
R["Q1"] = dict(rho=float(rho), p=float((1 + cn) / 10001), stable=bool(rho > 0.7 and (1 + cn) / 10001 < 0.01), top3_hours_A=[int(x) for x in mA.sort_values(ascending=False).index[:3]], top3_hours_B=[int(x) for x in mB.sort_values(ascending=False).index[:3]],
               low3_hours_B=[int(x) for x in mB.sort_values().index[:3]], range_pct_by_hour_B={int(k): round(float(v) * 100, 3) for k, v in mB.items()})
dd = d.groupby(d["ts"].dt.date).agg(h=("h", "max"), l=("l", "min"), c=("c", "last"), wd=("wd", "first"), yr=("yr", "first")); dd["r"] = (dd["h"] - dd["l"]) / dd["c"]
wk = {}
for y, g in dd.groupby("yr"): wk[int(y)] = round(float(g[g["wd"] >= 5]["r"].median() / g[g["wd"] < 5]["r"].median()), 3)
R["Q2"] = dict(weekend_over_weekday_range=wk, years_below_1=int(sum(v < 1 for k, v in wk.items() if k <= 2026)), stable=bool(sum(v < 1 for k, v in wk.items()) >= 6))
fb = {}
for y, g in d.groupby("yr"): fb[int(y)] = round(float(g[g["hr"].isin([0, 8, 16])]["rng"].median() / g[~g["hr"].isin([0, 8, 16])]["rng"].median()), 3)
R["Q3"] = dict(funding_hours_over_others=fb, years_above_1=int(sum(v > 1 for v in fb.values())), stable=bool(sum(v > 1 for v in fb.values()) >= 6))
ret = np.log(d["c"] / d["c"].shift(1)); rv = ret.rolling(720).std() * np.sqrt(24 * 365) * 100
rvd = pd.DataFrame({"ts": d["ts"], "rv": rv}).dropna(); rvd["yr"] = rvd["ts"].dt.year
R["realised_vol_pct_annualised_by_year_median"] = {int(y): round(float(g["rv"].median()), 1) for y, g in rvd.groupby("yr")}
R["realised_vol_now"] = round(float(rv.iloc[-1]), 1); R["realised_vol_now_percentile"] = round(float((rvd["rv"] <= rv.iloc[-1]).mean() * 100), 1)
c = d.set_index("ts")["c"]; ath = c.cummax(); dds = c / ath - 1
R["drawdown_now_pct"] = round(float(dds.iloc[-1] * 100), 1); R["max_drawdown_pct"] = round(float(dds.min() * 100), 1)
days_below10 = float((dds < -0.10).mean() * 100); R["share_of_time_more_than_10pct_below_ath"] = round(days_below10, 1)
R["share_of_time_more_than_30pct_below_ath"] = round(float((dds < -0.30).mean() * 100), 1)
json.dump(R, open(sys.argv[2] if len(sys.argv) > 2 else "lab_c2_results.json", "w"), indent=1)
print(json.dumps(R, indent=1))
