"""AT24 Research Lab 03b - EXPLORATORY follow-up to S1 (not pre-registered; hypothesis-generating only).

Lab 03 S1 found that the Asian-range sweep REVERSAL trade loses money in all three periods. The follow-up asks three diagnostic questions on the SAME events:
  (a) what does the mirror trade (CONTINUATION in the sweep direction, same distance, same costs) earn?
  (b) what does a random-direction trade of the same size earn (the mechanical cost of the structure)?
  (c) is the continuation result stable by year?
Because the events were already used by S1 these numbers are in-sample for the new idea: they can only be REGISTERED in the Forward Ledger, never claimed.
"""
import sys, json, numpy as np, pandas as pd
from scipy import stats
from zoneinfo import ZoneInfo
rng = np.random.default_rng(20261112)
NY = ZoneInfo("America/New_York"); D = sys.argv[1] if len(sys.argv) > 1 else "E:/at24_lab_data"
COST = 0.25
h = pd.read_csv(f"{D}/lab_xauusd_h1.csv"); h["utc"] = pd.to_datetime(h["gmt"], unit="s", utc=True); h["ny"] = h["utc"].dt.tz_convert(NY)
h["hour_ny"] = h["ny"].dt.hour; h["tday"] = (h["ny"] + pd.Timedelta(hours=6)).dt.date
cov = h.groupby("tday")["hour_ny"].nunique(); h = h[h["tday"] >= cov[cov >= 22].index[0]].reset_index(drop=True)
h["gday"] = h["utc"].dt.floor("D"); h["ghour"] = h["utc"].dt.hour

def simulate(idx, d, stop, R_, gday):
    """enter at open of bar idx+1 in direction d, stop at `stop`, target 1R away, time exit GMT 16:00 / 11 bars; stop wins a tie. returns net R"""
    entry = h.loc[idx + 1, "open"]; target = entry + d * R_; res = None
    for j in range(idx + 1, min(idx + 12, len(h))):
        b = h.loc[j]
        if b["gday"] != gday or b["ghour"] >= 16: res = (b["open"] - entry) * d if j > idx + 1 else 0.0; break
        hit_stop = (b["low"] <= stop) if d == 1 else (b["high"] >= stop)
        hit_tgt = (b["high"] >= target) if d == 1 else (b["low"] <= target)
        if hit_stop: res = -R_; break
        if hit_tgt: res = R_; break
    if res is None: res = (h.loc[min(idx + 11, len(h) - 1), "close"] - entry) * d
    return (res - COST) / R_

rows = []
for gday, g in h.groupby("gday"):
    asia = g[g["ghour"] < 7]; win = g[(g["ghour"] >= 7) & (g["ghour"] <= 12)]
    if len(asia) < 6 or len(win) < 4: continue
    hi, lo = asia["high"].max(), asia["low"].min(); sweep = None
    for idx, b in win.iterrows():
        up = b["high"] > hi and b["close"] <= hi; dn = b["low"] < lo and b["close"] >= lo
        if up and dn: break
        if up: sweep = (idx, -1, b["high"]); break
        if dn: sweep = (idx, 1, b["low"]); break
    if not sweep: continue
    idx, d, ext = sweep
    if idx + 1 >= len(h) or h.loc[idx + 1, "gday"] != gday: continue
    entry = h.loc[idx + 1, "open"]; R_ = abs(entry - ext)
    if R_ <= 0.5: continue
    rev = simulate(idx, d, ext, R_, gday)                          # the S1 trade (stop at the sweep extreme)
    cont = simulate(idx, -d, entry + d * R_, R_, gday)             # mirror: go with the sweep, stop R on the other side
    dir_r = int(rng.choice([-1, 1])); rnd = simulate(idx, dir_r, entry - dir_r * R_, R_, gday)
    rows.append(dict(t=h.loc[idx + 1, "utc"], year=h.loc[idx + 1, "utc"].year, rev=rev, cont=cont, rnd=rnd, R=R_))
df = pd.DataFrame(rows)
out = {}
for name in ["rev", "cont", "rnd"]:
    t = stats.ttest_1samp(df[name], 0.0)
    out[name] = dict(n=int(len(df)), mean_R=float(df[name].mean()), hit=float((df[name] > 0).mean()), t=float(t.statistic), p=float(t.pvalue))
out["typical_R_usd"] = float(df["R"].median())
for a, b in [("rev", "rnd"), ("cont", "rnd"), ("rev", "cont")]:
    d_ = df[a] - df[b]; t_ = stats.ttest_1samp(d_, 0.0)
    out[f"paired_{a}_minus_{b}"] = dict(mean_R=float(d_.mean()), t=float(t_.statistic), p=float(t_.pvalue))
out["by_year_cont"] = {int(y): dict(n=int(len(g)), mean_R=float(g["cont"].mean()), t=float(stats.ttest_1samp(g["cont"], 0.0).statistic) if len(g) > 2 else 0.0) for y, g in df.groupby("year")}
out["by_year_rev"] = {int(y): dict(n=int(len(g)), mean_R=float(g["rev"].mean())) for y, g in df.groupby("year")}
print(json.dumps(out, indent=1))
json.dump(out, open("../reports/lab03b_results.json", "w"), indent=1)
