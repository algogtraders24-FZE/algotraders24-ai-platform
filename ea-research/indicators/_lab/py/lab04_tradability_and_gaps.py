"""AT24 Research Lab 04 - when is gold cheap to trade, and what happens at the daily break after high-impact news.

PRE-REGISTRATION (written 2026-11-10 BEFORE any result of this script was seen; XAUUSD, one broker feed; cross-asset checks are NOT possible because
the offline terminal holds only XAUUSD history, so they are explicitly out of scope).

Data: H1 bars (time, gmt, OHLC, tick volume, spread in broker points; 1 point assumed = 0.01 price units, 19 points = 0.19 USD) and the USD calendar
(importance 3 = high). History guard: only the first full hourly day onwards (2021-05-05); spread statistics only from 2025-01-02 (spread field filled
> 95 % of bars, see AT24 History Doctor). New York time with zoneinfo.

Hypotheses (family of 5, Bonferroni alpha = 0.05 / 5 = 0.01):
  A1  The cost of trading, spread / hourly range (USD / USD), differs by New York hour of day. Kruskal-Wallis over the 24 hours, in period X
      (2025-01-02..2025-12-31) and in period Y (2026-01-01..end of data). Finding only if p < 0.01 in BOTH.
  A2  The ranking of the hours by median cost/range is stable: Spearman rank correlation between period X and period Y, permutation p (hours shuffled)
      < 0.01 and rho > 0.5.
  B1  The daily-break gap (open of the NY 18:00 bar vs close of the NY 16:00 bar, basis points, absolute value) is larger on "news days" (at least one
      high-importance USD event between NY 08:00 and 16:59 of that NY date) than on "quiet days" (none of any importance in that window).
      Permutation test of the mean difference.
  B2  On news days the sign of the gap agrees with the sign of the day's move (NY 08:00 open to the NY 16:00 close): correlation of the two, permutation.
  B3  On news days the gap is filled (price trades back through the pre-break close within the next 6 hours) more often than on quiet days.
      Permutation test of the difference in proportions.
  For B1-B3: periods train 2021-05-05..2023-12-31, validation 2024-01-01..2025-06-30, final 2025-07-01..end. FINDING only if p_train < 0.01 AND
  same sign with p_val < 0.05 AND same sign in final (p_final < 0.10 or n_final < 30 news days).
Descriptive output (no test): the tradability map = per New York hour median spread (USD), median hourly range (USD), median cost/range and rank, for
2025-01-02 onwards (this feeds a possible indicator; it makes no performance claim).
Seeds fixed. Results are reported whatever they are.
"""
import sys, json
import numpy as np, pandas as pd
from scipy import stats
from zoneinfo import ZoneInfo
rng = np.random.default_rng(20261112)
NY = ZoneInfo("America/New_York"); D = sys.argv[1] if len(sys.argv) > 1 else "E:/at24_lab_data"
BONF = 0.05 / 5; POINT = 0.01
h = pd.read_csv(f"{D}/lab_xauusd_h1.csv"); h["utc"] = pd.to_datetime(h["gmt"], unit="s", utc=True); h["ny"] = h["utc"].dt.tz_convert(NY)
h["hour_ny"] = h["ny"].dt.hour; h["nydate"] = h["ny"].dt.date
h["tday"] = (h["ny"] + pd.Timedelta(hours=6)).dt.date
cov = h.groupby("tday")["hour_ny"].nunique(); h = h[h["tday"] >= cov[cov >= 22].index[0]].reset_index(drop=True)
R = {}

# ---------------- A: tradability by hour ----------------
s = h[h["utc"] >= pd.Timestamp("2025-01-02", tz="UTC")].copy()
s = s[s["spread"] > 0]; s["spr_usd"] = s["spread"] * POINT; s["rng"] = s["high"] - s["low"]; s = s[s["rng"] > 0]
s["ratio"] = s["spr_usd"] / s["rng"]
X = s[s["utc"] < pd.Timestamp("2026-01-01", tz="UTC")]; Y = s[s["utc"] >= pd.Timestamp("2026-01-01", tz="UTC")]
def kw(df):
    g = [df.loc[df["hour_ny"] == k, "ratio"].values for k in range(24) if (df["hour_ny"] == k).sum() >= 20]
    r = stats.kruskal(*g); return dict(n=int(len(df)), H=float(r.statistic), p=float(r.pvalue), groups=len(g))
A1 = dict(X=kw(X), Y=kw(Y)); A1["finding"] = bool(A1["X"]["p"] < BONF and A1["Y"]["p"] < BONF); R["A1"] = A1
medX = X.groupby("hour_ny")["ratio"].median().reindex(range(24)); medY = Y.groupby("hour_ny")["ratio"].median().reindex(range(24))
ok = medX.notna() & medY.notna(); rho = stats.spearmanr(medX[ok], medY[ok]).statistic
cnt = 0
for _ in range(10000):
    if stats.spearmanr(medX[ok], rng.permutation(medY[ok].values)).statistic >= rho: cnt += 1
R["A2"] = dict(hours=int(ok.sum()), rho=float(rho), p=float((1 + cnt) / 10001)); R["A2"]["finding"] = bool(R["A2"]["p"] < BONF and rho > 0.5)
tm = s.groupby("hour_ny").agg(spread_usd=("spr_usd", "median"), range_usd=("rng", "median"), ratio=("ratio", "median"), bars=("ratio", "size"))
tm["rank_cheapest"] = tm["ratio"].rank().astype(int)
R["tradability_map"] = {int(k): {c: float(v) for c, v in row.items()} for k, row in tm.iterrows()}

# ---------------- B: the daily break after news ----------------
h["gap_prev"] = h["gmt"].diff(); prev_close = h["close"].shift(1); prev_hr = h["hour_ny"].shift(1); prev_date = h["nydate"].shift(1)
brk = h[(h["gap_prev"] == 7200) & (h["hour_ny"] == 18) & (prev_hr == 16)].copy()
brk["pclose"] = prev_close[brk.index]; brk["date"] = prev_date[brk.index]; brk["gap_bp"] = 1e4 * np.log(brk["open"] / brk["pclose"])
# day move: NY 08:00 open to NY 16:00 close of the same NY date
o8 = h[h["hour_ny"] == 8].set_index("nydate")["open"]; c16 = h[h["hour_ny"] == 16].set_index("nydate")["close"]
brk["day_bp"] = [1e4 * np.log(c16[d] / o8[d]) if (d in o8.index and d in c16.index) else np.nan for d in brk["date"]]
# fill within 6 hours after the break: gap up filled if a later low <= pclose, gap down if a later high >= pclose
fill = []
idx = {i: k for k, i in enumerate(h.index)}
for i, r in brk.iterrows():
    k = idx[i]; w = h.iloc[k:k + 6]
    if len(w) < 6 or r["gap_bp"] == 0: fill.append(np.nan); continue
    fill.append(float(w["low"].min() <= r["pclose"]) if r["gap_bp"] > 0 else float(w["high"].max() >= r["pclose"]))
brk["fill"] = fill
ev = pd.read_csv(f"{D}/lab_usd_events.csv"); ev["utc"] = pd.to_datetime(ev["gmt"], unit="s", utc=True); ev["ny"] = ev["utc"].dt.tz_convert(NY)
win = ev[(ev["ny"].dt.hour >= 8) & (ev["ny"].dt.hour <= 16)]
hi = set(win.loc[win["importance"] == 3, "ny"].dt.date); anyev = set(win["ny"].dt.date)
brk["news"] = brk["date"].isin(hi); brk["quiet"] = ~brk["date"].isin(anyev)
brk = brk[brk["news"] | brk["quiet"]].copy()
T1, T2 = pd.Timestamp("2024-01-01", tz="UTC"), pd.Timestamp("2025-07-01", tz="UTC")
brk["period"] = np.where(brk["utc"] < T1, "train", np.where(brk["utc"] < T2, "val", "final"))

def perm_diff(a, b, n=10000):
    a, b = np.asarray(a, float), np.asarray(b, float); d0 = a.mean() - b.mean(); pool = np.concatenate([a, b]); c = 0
    for _ in range(n):
        rng.shuffle(pool)
        if abs(pool[:len(a)].mean() - pool[len(a):].mean()) >= abs(d0): c += 1
    return float(d0), float((1 + c) / (n + 1))
def verdict(pt, pv, pf, st, sv, sf, nf):
    return bool(pt < BONF and pv < 0.05 and st * sv > 0 and st * sf > 0 and (pf < 0.10 or nf < 30))
B1, B2, B3 = {}, {}, {}
for per in ["train", "val", "final"]:
    d = brk[brk["period"] == per]; nw, qu = d[d["news"]], d[d["quiet"]]
    if len(nw) < 8 or len(qu) < 8: B1[per] = B2[per] = B3[per] = dict(n_news=int(len(nw)), n_quiet=int(len(qu)), p=1.0, diff=0.0, corr=0.0); continue
    d0, p0 = perm_diff(nw["gap_bp"].abs(), qu["gap_bp"].abs()); B1[per] = dict(n_news=int(len(nw)), n_quiet=int(len(qu)), mean_abs_news=float(nw["gap_bp"].abs().mean()), mean_abs_quiet=float(qu["gap_bp"].abs().mean()), diff=d0, p=p0)
    j = nw.dropna(subset=["day_bp"]); j = j[(j["gap_bp"] != 0) & (j["day_bp"] != 0)]
    c0 = float(np.corrcoef(np.sign(j["gap_bp"]), np.sign(j["day_bp"]))[0, 1]); cnt = 0
    for _ in range(5000):
        if abs(np.corrcoef(np.sign(j["gap_bp"]), rng.permutation(np.sign(j["day_bp"].values)))[0, 1]) >= abs(c0): cnt += 1
    B2[per] = dict(n=int(len(j)), corr=c0, p=float((1 + cnt) / 5001))
    fn, fq = nw["fill"].dropna(), qu["fill"].dropna(); d0, p0 = perm_diff(fn, fq)
    B3[per] = dict(n_news=int(len(fn)), n_quiet=int(len(fq)), fill_news=float(fn.mean()), fill_quiet=float(fq.mean()), diff=d0, p=p0)
B1["finding"] = verdict(B1["train"]["p"], B1["val"]["p"], B1["final"]["p"], B1["train"]["diff"], B1["val"]["diff"], B1["final"]["diff"], B1["final"].get("n_news", 0))
B2["finding"] = verdict(B2["train"]["p"], B2["val"]["p"], B2["final"]["p"], B2["train"]["corr"], B2["val"]["corr"], B2["final"]["corr"], B2["final"].get("n", 0))
B3["finding"] = verdict(B3["train"]["p"], B3["val"]["p"], B3["final"]["p"], B3["train"]["diff"], B3["val"]["diff"], B3["final"]["diff"], B3["final"].get("n_news", 0))
R["B1"], R["B2"], R["B3"] = B1, B2, B3
R["break_days"] = dict(total=int(len(brk)), news=int(brk["news"].sum()), quiet=int(brk["quiet"].sum()))
json.dump(R, open(sys.argv[2] if len(sys.argv) > 2 else "lab04_results.json", "w"), indent=1)
for k in ["A1", "A2", "B1", "B2", "B3"]: print(k, json.dumps(R[k]))
print("break days", R["break_days"])
print("map (hour: spread $, range $, cost/range, rank):")
for k, v in R["tradability_map"].items(): print(f"  NY {k:02d}  {v['spread_usd']:.2f}  {v['range_usd']:.2f}  {v['ratio']:.3f}  #{int(v['rank_cheapest'])}")
