import numpy as np, pandas as pd, glob, os, json, warnings
warnings.filterwarnings("ignore")
from sklearn.neighbors import KNeighborsRegressor, NearestNeighbors
from scipy import stats
H = 24; K = 30; SEP = 24; POOL = 400

def load(f):
    d = pd.read_csv(f)
    d["time"] = pd.to_datetime(d["time"], format="%Y.%m.%d %H:%M")
    return d.sort_values("time").drop_duplicates("time").reset_index(drop=True)

def feats(d):
    c, h, l = d.close, d.high, d.low
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    atr = tr.rolling(14).mean(); a100 = tr.rolling(100).mean()
    X = pd.DataFrame(index=d.index)
    for n in (1, 3, 6, 12, 24, 48):
        X[f"r{n}"] = (c - c.shift(n)) / atr
    X["vol"] = np.log(atr / a100)
    dl = c.diff(); up = dl.clip(lower=0).rolling(14).mean(); dn = (-dl.clip(upper=0)).rolling(14).mean()
    X["rsi"] = (100 - 100 / (1 + up / (dn + 1e-12)) - 50) / 25
    for n in (20, 50, 200):
        X[f"e{n}"] = (c - c.ewm(span=n, adjust=False).mean()) / atr
    X["pos"] = (c - l.rolling(48).min()) / (h.rolling(48).max() - l.rolling(48).min() + 1e-12)
    fwd = (c.shift(-H) - c) / atr
    return X, fwd, atr

res = {}
for f in sorted(glob.glob("E:/at24_kill/live/KX_*_H1.csv")):
    sym = os.path.basename(f).split("_")[1]
    if "XAUEUR" in sym: continue
    d = load(f); X, fwd, atr = feats(d); n = len(d)
    ok = X.notna().all(axis=1) & fwd.notna() & atr.notna()
    idx = np.where(ok)[0]; i0 = int(n * 0.6)
    tr_i = idx[idx < i0 - H]; te_i = idx[idx >= i0][::H]            # non-overlapping test points
    if len(tr_i) < 3000 or len(te_i) < 100: continue
    mu, sd = X.iloc[tr_i].mean(), X.iloc[tr_i].std() + 1e-12
    Ztr = ((X.iloc[tr_i] - mu) / sd).values; Zte = ((X.iloc[te_i] - mu) / sd).values
    ytr = fwd.iloc[tr_i].values; yte = fwd.iloc[te_i].values
    nn = NearestNeighbors(n_neighbors=POOL, n_jobs=2).fit(Ztr)
    dist, ind = nn.kneighbors(Zte)
    nbl = []
    for row in ind:
        sel_ = []
        for j in row:
            if all(abs(int(tr_i[j]) - int(tr_i[q])) >= SEP for q in sel_):
                sel_.append(j)
                if len(sel_) == K: break
        while len(sel_) < K: sel_.append(sel_[-1])
        nbl.append(ytr[sel_])
    nb = np.array(nbl)                                    # K analog outcomes per test point
    med = np.median(nb, axis=1); mean = nb.mean(axis=1); pup = (nb > 0).mean(axis=1)
    q10 = np.quantile(nb, 0.1, axis=1); q90 = np.quantile(nb, 0.9, axis=1)
    cover = float(np.mean((yte >= q10) & (yte <= q90)))
    # direction: trade the sign of the analog mean when the analogs agree (>= 60 % one side)
    sel = (pup >= 0.6) | (pup <= 0.4)
    sg = np.where(pup >= 0.5, 1, -1)
    r = sg[sel] * yte[sel]
    hit = float((r > 0).mean()) if sel.sum() else float("nan")
    avg = float(r.mean()) if sel.sum() else float("nan")
    # plain baseline: always long
    base = float(yte.mean())
    # sign-flip luck test on the selected trades
    rng = np.random.default_rng(1)
    if sel.sum() > 20:
        fl = np.array([(r * rng.choice([-1, 1], len(r))).mean() for _ in range(3000)]); p = float((fl >= avg).mean())
    else: p = float("nan")
    # does the analog spread track the realised spread? correlation of analog IQR with |actual - analog median|
    iqr = np.quantile(nb, 0.75, axis=1) - np.quantile(nb, 0.25, axis=1)
    cs = float(stats.spearmanr(iqr, np.abs(yte - med))[0])
    res[sym] = dict(n_test=len(te_i), n_sel=int(sel.sum()), band80_cover=round(cover, 3), hit=round(hit, 3), avg_atr=round(avg, 3), p_luck=round(p, 3), always_long=round(base, 3), spread_corr=round(cs, 3))
    print(sym, json.dumps(res[sym]), flush=True)
json.dump(res, open("E:/at24_kill/analog_rnd_sep.json", "w"), indent=1)
a = pd.DataFrame(res).T
print("MEAN over symbols:", a[["band80_cover", "hit", "avg_atr", "p_luck", "spread_corr"]].astype(float).mean().round(3).to_dict())
print("symbols with p<0.10:", int((a.p_luck.astype(float) < 0.10).sum()), "of", len(a), "; hit>0.5:", int((a.hit.astype(float) > 0.5).sum()))
