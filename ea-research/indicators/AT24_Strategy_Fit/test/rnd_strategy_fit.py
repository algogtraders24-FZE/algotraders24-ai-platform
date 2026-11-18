import numpy as np, pandas as pd, glob, os, json, warnings
warnings.filterwarnings("ignore")
MU = np.array([0.163863, -0.031967, 1.014311, 5.525808]); SD = np.array([0.119898, 0.26684, 0.766584, 1.932356])
CENT = np.array([[0.1023, 0.1663, 0.6141, 4.3468], [0.1219, -0.2405, 1.3098, 7.4327], [0.3395, -0.1325, 2.6010, 9.4282], [0.1197, -0.2249, 0.4958, 4.6743], [0.2955, 0.1396, 1.5741, 5.6380]])
NAMES = ["NOISY", "WIDE SWING", "STRONG MOVE", "COMPRESSED", "STEADY TREND"]
HOLD = 24

def load(f):
    d = pd.read_csv(f)
    d["time"] = pd.to_datetime(d["time"], format="%Y.%m.%d %H:%M")
    d = d.sort_values("time").drop_duplicates("time").reset_index(drop=True)
    dec = int(d.close.astype(str).str.split(".").str[1].str.len().tail(500).max())
    sp = d.spread[d.spread > 0].tail(20000)
    d.attrs["cost"] = (float(sp.median()) * 10 ** (-dec)) if len(sp) > 100 else float(d.close.tail(5000).mean()) * 0.001
    return d

def run(d):
    o, h, l, c = d.open, d.high, d.low, d.close
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    a14 = tr.rolling(14).mean(); a100 = tr.rolling(100).mean()
    er = (c - c.shift(48)).abs() / c.diff().abs().rolling(48).sum()
    lvol = np.log(a14 / a100)
    ema = c.ewm(span=20, adjust=False).mean()
    slope = ((ema - ema.shift(10)).abs() / a14).clip(upper=6)
    rngx = ((h.rolling(24).max() - l.rolling(24).min()) / a14).clip(upper=30)
    Z = (np.column_stack([er, lvol, slope, rngx]) - MU) / SD
    ZC = (CENT - MU) / SD
    dist = ((Z[:, None, :] - ZC[None, :, :]) ** 2).sum(2)
    state = np.argmin(dist, axis=1)
    valid = (~np.isnan(Z).any(axis=1)) & (np.arange(len(d)) >= 99)
    e50 = c.ewm(span=50, adjust=False).mean(); e200 = c.ewm(span=200, adjust=False).mean()
    up = (c > e50) & (e50 > e200); dn = (c < e50) & (e50 < e200)
    trend = np.where(up, 1, np.where(dn, -1, 0))
    hh = h.shift(1).rolling(20).max(); ll = l.shift(1).rolling(20).min()
    brk = np.where(c > hh, 1, np.where(c < ll, -1, 0))
    dlt = c.diff(); upv = dlt.clip(lower=0).rolling(14).mean(); dnv = (-dlt.clip(upper=0)).rolling(14).mean()
    rsi = 100 - 100 / (1 + upv / (dnv + 1e-12))
    rev = np.where(rsi < 30, 1, np.where(rsi > 70, -1, 0))
    entry = o.shift(-1); ex = o.shift(-1 - HOLD)
    fwd = (ex - entry)
    n = len(d); i0 = int(n * 0.6)
    out = {}
    for name, sig in (("trend", trend), ("breakout", brk), ("reversion", rev)):
        rows = []
        last = -10**9
        for i in range(i0, n - HOLD - 2):
            if not valid[i] or sig[i] == 0 or np.isnan(fwd.iloc[i]) or np.isnan(a14.iloc[i]): continue
            if i - last < HOLD: continue
            last = i
            r = (sig[i] * fwd.iloc[i] - d.attrs["cost"]) / a14.iloc[i]
            rows.append((state[i], r))
        out[name] = rows
    return out

files = sorted(f for f in glob.glob("E:/at24_kill/live/KX_*_H1.csv") if "XAUEUR" not in f)
agg = {r: {s: [] for s in range(5)} for r in ("trend", "breakout", "reversion")}
per = {r: {s: [] for s in range(5)} for r in agg}
for f in files:
    sym = os.path.basename(f).split("_")[1]
    d = load(f); res = run(d)
    for r, rows in res.items():
        for s in range(5):
            v = [x[1] for x in rows if x[0] == s]
            agg[r][s] += v
            if len(v) >= 30: per[r][s].append((sym, float(np.mean(v)), len(v)))
for r in agg:
    print("==", r)
    for s in range(5):
        v = np.array(agg[r][s])
        pos = sum(1 for x in per[r][s] if x[1] > 0)
        print(f"{NAMES[s]:13s} n={len(v):5d} avgR={v.mean():+.3f}  symbols positive {pos}/{len(per[r][s])}")
json.dump({r: {NAMES[s]: {"n": len(agg[r][s]), "avg": float(np.mean(agg[r][s])), "per": per[r][s]} for s in range(5)} for r in agg}, open("E:/at24_kill/sf_rnd.json", "w"), indent=1)
