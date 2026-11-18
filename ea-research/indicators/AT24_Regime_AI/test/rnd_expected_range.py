import numpy as np, pandas as pd, glob, os, json, warnings
warnings.filterwarnings("ignore")
MU = np.array([0.163863, -0.031967, 1.014311, 5.525808]); SD = np.array([0.119898, 0.26684, 0.766584, 1.932356])
CENT = np.array([[0.1023, 0.1663, 0.6141, 4.3468], [0.1219, -0.2405, 1.3098, 7.4327], [0.3395, -0.1325, 2.6010, 9.4282], [0.1197, -0.2249, 0.4958, 4.6743], [0.2955, 0.1396, 1.5741, 5.6380]])
H = 24

def load(f):
    d = pd.read_csv(f)
    d["time"] = pd.to_datetime(d["time"], format="%Y.%m.%d %H:%M")
    return d.sort_values("time").drop_duplicates("time").reset_index(drop=True)

def ridge(X, y, lam=1.0):
    Xm = X.mean(0); Xs = X.std(0) + 1e-12
    Z = (X - Xm) / Xs
    A = Z.T @ Z + lam * np.eye(Z.shape[1]); w = np.linalg.solve(A, Z.T @ (y - y.mean()))
    return lambda Xn: ((Xn - Xm) / Xs) @ w + y.mean()

def r2(y, p): return 1 - ((y - p) ** 2).sum() / ((y - y.mean()) ** 2).sum()

out = {}
for f in sorted(glob.glob("E:/at24_kill/live/KX_*_H1.csv")):
    sym = os.path.basename(f).split("_")[1]
    if "XAUEUR" in sym: continue
    d = load(f); n = len(d)
    c, h, l = d.close, d.high, d.low
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    a14 = tr.rolling(14).mean(); a100 = tr.rolling(100).mean()
    er = (c - c.shift(48)).abs() / c.diff().abs().rolling(48).sum()
    lv = np.log(a14 / a100)
    ema = c.ewm(span=20, adjust=False).mean()
    slope = ((ema - ema.shift(10)).abs() / a14).clip(upper=6)
    rngx = ((h.rolling(24).max() - l.rolling(24).min()) / a14).clip(upper=30)
    Z = (np.column_stack([er, lv, slope, rngx]) - MU) / SD; ZC = (CENT - MU) / SD
    state = np.argmin(((Z[:, None, :] - ZC[None, :, :]) ** 2).sum(2), axis=1)
    fr = (h[::-1].rolling(H).max()[::-1].shift(-1) - l[::-1].rolling(H).min()[::-1].shift(-1)) / c
    y = np.log(fr)
    hr = d.time.dt.hour.values
    base = pd.DataFrame({"la14": np.log(a14 / c), "la24": np.log(tr.rolling(24).mean() / c), "la120": np.log(tr.rolling(120).mean() / c)})
    ok = base.notna().all(axis=1) & np.isfinite(y) & (np.arange(n) >= 150) & (~np.isnan(Z).any(axis=1))
    idx = np.where(ok)[0]; i0 = int(n * 0.6)
    tr_i = idx[idx < i0 - 48]; te_i = idx[idx >= i0]
    # seasonal: mean log range by hour of day over the training part (past only)
    yt = y.values if hasattr(y, "values") else y
    sea = {hh: np.mean(yt[tr_i][hr[tr_i] == hh]) for hh in range(24)}
    sea_te = np.array([sea[hr[i]] for i in te_i]); sea_tr = np.array([sea[hr[i]] for i in tr_i])
    B = base.values
    onehot = np.eye(5)[state]
    feats = {
        "atr_only": B[:, [0]],
        "atr+seasonal": np.column_stack([B[:, [0, 1, 2]], np.array([sea[x] for x in hr])]),
        "atr+seasonal+states": np.column_stack([B[:, [0, 1, 2]], np.array([sea[x] for x in hr]), onehot[:, 1:]]),
        "atr+seasonal+states+features": np.column_stack([B[:, [0, 1, 2]], np.array([sea[x] for x in hr]), onehot[:, 1:], np.nan_to_num(Z)]),
    }
    res = {}
    for k, X in feats.items():
        m = ridge(X[tr_i], yt[tr_i]); p = m(X[te_i])
        res[k] = round(float(r2(yt[te_i], p)), 3)
        if k == "atr+seasonal+states":
            resid = yt[tr_i] - m(X[tr_i]); q10, q90 = np.quantile(resid, [0.1, 0.9])
            cover = float(np.mean((yt[te_i] >= p + q10) & (yt[te_i] <= p + q90)))
            res["cover80"] = round(cover, 3)
    out[sym] = res
    print(sym, json.dumps(res), flush=True)
json.dump(out, open("E:/at24_kill/vol_rnd.json", "w"), indent=1)
