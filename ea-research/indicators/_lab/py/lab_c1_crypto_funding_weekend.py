"""AT24 Research Lab C1 - first crypto lab: perpetual funding extremes and the weekend, BTC (primary) with ETH as an uncounted replication.

PRE-REGISTRATION (written 2026-11-11 BEFORE any result of this script was seen). Data: Binance public REST (USDT-margined perpetuals): funding rate history
(every 8 h), 8-hour and daily klines of the perpetual contract. Downloaded and cached under E:/at24_lab_data/crypto. No keys, read-only.

  C1a Crowded longs pay: when the 8 h funding rate is in the top decile of its previous 270 observations (about 90 days, shifted by one so the current
      value is not in its own reference), the next 24 hours (three 8 h bars: close of the bar at the funding time to the close three bars later) return
      LESS than after other fundings. Test: mean forward 24 h log return (bp) when extreme-high MINUS otherwise, permutation test, expected negative.
  C1b Crowded shorts pay: funding in the bottom decile of the same reference, next 24 h return MORE than otherwise (expected positive); same test.
  C2  Weekend drift: Saturday and Sunday daily close-to-close log returns (UTC days) versus Monday to Friday. Test: mean difference, permutation test.
  Family of 3, Bonferroni alpha = 0.05 / 3 = 0.0167. Periods: train 2020-01-01..2022-12-31, validation 2023-01-01..2024-06-30, final 2024-07-01..end.
  FINDING only if p_train < alpha AND same sign with p_val < 0.05 AND same sign in final (p_final < 0.10 or fewer than 30 events in final).
  Overlapping 24 h windows: events at least 24 h apart only (the first of any cluster, then skip 3 funding periods); the "otherwise" group uses all fundings
  that are not extreme at non-overlapping spacing of 3 periods as well (every third funding, starting at a random-free fixed offset 0).
Descriptive output (no test): annualised funding yield of a delta-neutral long-spot / short-perp position (mean funding x 3 x 365, before fees and
margin costs) per year, to show how the carry has moved. Seeds fixed. Results are reported whatever they are.
"""
import sys, json, os, time, urllib.request
import numpy as np, pandas as pd
rng = np.random.default_rng(20261115)
OUT = "E:/at24_lab_data/crypto"; os.makedirs(OUT, exist_ok=True)
BONF = 0.05 / 3
def get(url):
    for _ in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "at24-research"}), timeout=30) as r: return json.loads(r.read())
        except Exception: time.sleep(2)
    raise RuntimeError(url)
def funding(sym):
    f = f"{OUT}/{sym}_funding.csv"
    if os.path.exists(f): return pd.read_csv(f)
    rows, t = [], 1567296000000
    while True:
        d = get(f"https://fapi.binance.com/fapi/v1/fundingRate?symbol={sym}&startTime={t}&limit=1000")
        if not d: break
        rows += [(x["fundingTime"], float(x["fundingRate"])) for x in d]
        t = d[-1]["fundingTime"] + 1
        if len(d) < 1000: break
    df = pd.DataFrame(rows, columns=["t", "rate"]).drop_duplicates("t"); df.to_csv(f, index=False); return df
def klines(sym, interval):
    f = f"{OUT}/{sym}_{interval}.csv"
    if os.path.exists(f): return pd.read_csv(f)
    rows, t = [], 1567296000000
    while True:
        d = get(f"https://fapi.binance.com/fapi/v1/klines?symbol={sym}&interval={interval}&startTime={t}&limit=1500")
        if not d: break
        rows += [(x[0], float(x[1]), float(x[2]), float(x[3]), float(x[4])) for x in d]
        t = d[-1][0] + 1
        if len(d) < 1500: break
    df = pd.DataFrame(rows, columns=["t", "o", "h", "l", "c"]).drop_duplicates("t"); df.to_csv(f, index=False); return df
def perm_diff(a, b, k=10000):
    a, b = np.asarray(a, float), np.asarray(b, float); d0 = a.mean() - b.mean(); pool = np.concatenate([a, b]); cn = 0
    for _ in range(k):
        rng.shuffle(pool)
        if abs(pool[:len(a)].mean() - pool[len(a):].mean()) >= abs(d0): cn += 1
    return float(d0), float((1 + cn) / (k + 1))
def verdict(pt, pv, pf, st, sv, sf, nf):
    return bool(pt < BONF and pv < 0.05 and st * sv > 0 and st * sf > 0 and (pf < 0.10 or nf < 30))
def per_of(ts):
    return "train" if ts < pd.Timestamp("2023-01-01") else ("val" if ts < pd.Timestamp("2024-07-01") else "final")
def run(sym):
    R = {}
    fd = funding(sym); k8 = klines(sym, "8h"); kd = klines(sym, "1d")
    fd["ts"] = pd.to_datetime(fd["t"], unit="ms"); k8["ts"] = pd.to_datetime(k8["t"], unit="ms"); kd["ts"] = pd.to_datetime(kd["t"], unit="ms")
    # align: funding at time T is paid at the 8h boundary; use the 8h bar that OPENS at T-8h ... the bar closing at T. Forward return: close(T) to close(T+24h).
    k8 = k8.set_index("t"); cl = k8["c"]
    fd["ref_hi"] = fd["rate"].shift(1).rolling(270).quantile(0.9); fd["ref_lo"] = fd["rate"].shift(1).rolling(270).quantile(0.1)
    fd["hi"] = fd["rate"] >= fd["ref_hi"]; fd["lo"] = fd["rate"] <= fd["ref_lo"]
    h8 = 8 * 3600 * 1000
    def fwd(t):
        a, b = t - h8, t + 2 * h8   # bar opening at t-8h closes at t; the bar opening at t+16h closes at t+24h
        return 1e4 * np.log(cl[b] / cl[a]) if (a in cl.index and b in cl.index) else np.nan
    fd["fwd"] = [fwd(t) for t in fd["t"]]; fd = fd.dropna(subset=["fwd", "ref_hi"]).reset_index(drop=True)
    for tag, col, sign in [("C1a", "hi", -1), ("C1b", "lo", 1)]:
        out = {}
        for per in ["train", "val", "final"]:
            d = fd[fd["ts"].apply(per_of) == per].reset_index(drop=True)
            idx_e, last = [], -3
            for i in range(len(d)):
                if d.loc[i, col] and i >= last + 3: idx_e.append(i); last = i
            ev = d.loc[idx_e, "fwd"]
            oth = d[(~d[col])].iloc[::3]["fwd"]
            if len(ev) < 8: out[per] = dict(n_event=int(len(ev)), n_other=int(len(oth)), diff=0.0, p=1.0); continue
            d0, p0 = perm_diff(ev, oth); out[per] = dict(n_event=int(len(ev)), n_other=int(len(oth)), mean_event=float(ev.mean()), mean_other=float(oth.mean()), diff=d0, p=p0)
        out["finding"] = verdict(out["train"]["p"], out["val"]["p"], out["final"]["p"], sign * out["train"]["diff"], sign * out["val"]["diff"], sign * out["final"]["diff"], out["final"]["n_event"])
        R[tag] = out
    kd["ret"] = 1e4 * np.log(kd["c"] / kd["c"].shift(1)); kd = kd.dropna(subset=["ret"]); kd["we"] = kd["ts"].dt.weekday >= 5
    kd = kd[kd["ts"] >= pd.Timestamp("2020-01-01")]; out = {}
    for per in ["train", "val", "final"]:
        d = kd[kd["ts"].apply(per_of) == per]; a, b = d[d["we"]]["ret"], d[~d["we"]]["ret"]; d0, p0 = perm_diff(a, b)
        out[per] = dict(n_weekend=int(len(a)), n_weekday=int(len(b)), mean_weekend=float(a.mean()), mean_weekday=float(b.mean()), diff=d0, p=p0)
    out["finding"] = verdict(out["train"]["p"], out["val"]["p"], out["final"]["p"], out["train"]["diff"], out["val"]["diff"], out["final"]["diff"], out["final"]["n_weekend"])
    R["C2"] = out
    fy = fd.groupby(fd["ts"].dt.year)["rate"].mean() * 3 * 365 * 100
    R["carry_yield_pct_per_year"] = {int(k): float(v) for k, v in fy.items()}
    return R
res = {s: run(s) for s in ["BTCUSDT", "ETHUSDT"]}
json.dump(res, open(sys.argv[1] if len(sys.argv) > 1 else "lab_c1_results.json", "w"), indent=1)
for s in res:
    print("=====", s)
    for k in ["C1a", "C1b", "C2"]: print(k, json.dumps(res[s][k]))
    print("carry %/yr", {k: round(v, 1) for k, v in res[s]["carry_yield_pct_per_year"].items()})
