import numpy as np, pandas as pd, glob, os, json, warnings
warnings.filterwarnings("ignore")
from sklearn.cluster import KMeans

def load(f):
    d = pd.read_csv(f)
    d["time"] = pd.to_datetime(d["time"], format="%Y.%m.%d %H:%M")
    return d.sort_values("time").drop_duplicates("time").reset_index(drop=True)

def feats(d):
    c, h, l = d.close, d.high, d.low
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    atr14 = tr.rolling(14).mean(); atr100 = tr.rolling(100).mean()
    X = pd.DataFrame(index=d.index)
    X["er"] = (c - c.shift(48)).abs() / (c.diff().abs().rolling(48).sum() + 1e-12)
    X["lvol"] = np.log(atr14 / atr100)
    ema = c.ewm(span=20, adjust=False).mean()
    X["slope"] = ((ema - ema.shift(10)).abs() / atr14).clip(upper=6)
    X["rngx"] = ((h.rolling(24).max() - l.rolling(24).min()) / atr14).clip(upper=30)
    # forward outcomes (24 bars): absolute move and range, in ATR units
    fa = (c.shift(-24) - c).abs() / atr14
    fr = (h[::-1].rolling(24).max()[::-1].shift(-1) - l[::-1].rolling(24).min()[::-1].shift(-1)) / atr14
    return X, fa, fr

files = sorted(glob.glob("E:/at24_kill/live/KX_*_H1.csv"))
files = [f for f in files if "XAUEUR" not in f]
data = {}
for f in files:
    s = os.path.basename(f).split("_")[1]
    d = load(f); X, fa, fr = feats(d)
    ok = X.notna().all(axis=1) & fa.notna() & fr.notna()
    data[s] = (d, X[ok], fa[ok], fr[ok])
# train on first 60% of each symbol, pooled
trs = []
for s, (d, X, fa, fr) in data.items():
    n = len(X); trs.append(X.iloc[: int(n * 0.6)])
T = pd.concat(trs)
mu, sd = T.mean(), T.std()
Z = ((T - mu) / sd).values
rng = np.random.default_rng(3)
Zs = Z[rng.choice(len(Z), min(len(Z), 120000), replace=False)]
K = 5
km = KMeans(K, n_init=6, random_state=1).fit(Zs)
# order clusters by volatility ratio then efficiency for readable names
cent = pd.DataFrame(km.cluster_centers_ * sd.values + mu.values, columns=T.columns)
print(cent.round(2).to_string())
res = {}
allrows = []
for s, (d, X, fa, fr) in data.items():
    n = len(X); i0 = int(n * 0.6)
    Xte = X.iloc[i0:]; lab = km.predict(((Xte - mu) / sd).values)
    fa_te = fa.iloc[i0:].values; fr_te = fr.iloc[i0:].values
    stay = (lab[1:] == lab[:-1]).mean()
    runs = []; r = 1
    for k in range(1, len(lab)):
        if lab[k] == lab[k - 1]: r += 1
        else: runs.append(r); r = 1
    row = {"n_test": len(lab), "stay": round(float(stay), 3), "mean_run": round(float(np.mean(runs)), 1), "share": [round(float((lab == k).mean()), 2) for k in range(K)],
           "fwd_move_atr": [round(float(fa_te[lab == k].mean()), 2) if (lab == k).sum() > 50 else None for k in range(K)],
           "fwd_range_atr": [round(float(fr_te[lab == k].mean()), 2) if (lab == k).sum() > 50 else None for k in range(K)],
           "all_move": round(float(fa_te.mean()), 2), "all_range": round(float(fr_te.mean()), 2)}
    res[s] = row
    print(s, json.dumps(row), flush=True)
json.dump({"centroids": cent.round(4).to_dict("list"), "mu": mu.round(6).to_dict(), "sd": sd.round(6).to_dict(), "res": res}, open("E:/at24_kill/regime_rnd.json", "w"), indent=1)
