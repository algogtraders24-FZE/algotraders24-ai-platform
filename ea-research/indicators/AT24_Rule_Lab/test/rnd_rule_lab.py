import numpy as np, pandas as pd, glob, os, json, warnings
warnings.filterwarnings("ignore")
MU = np.array([0.163863, -0.031967, 1.014311, 5.525808]); SD = np.array([0.119898, 0.26684, 0.766584, 1.932356])
CENT = np.array([[0.1023, 0.1663, 0.6141, 4.3468], [0.1219, -0.2405, 1.3098, 7.4327], [0.3395, -0.1325, 2.6010, 9.4282], [0.1197, -0.2249, 0.4958, 4.6743], [0.2955, 0.1396, 1.5741, 5.6380]])
NAMES = ["NOISY", "WIDE SWING", "STRONG MOVE", "COMPRESSED", "STEADY TREND"]
RULES = ["KAMA", "FRAMA", "HMA", "TSI", "VORTEX", "SQUEEZE"]
HOLD = 24; STOP = 2.0

def load(f):
    d = pd.read_csv(f)
    d["time"] = pd.to_datetime(d["time"], format="%Y.%m.%d %H:%M")
    d = d.sort_values("time").drop_duplicates("time").reset_index(drop=True)
    dec = int(d.close.astype(str).str.split(".").str[1].str.len().tail(500).max())
    sp = d.spread[d.spread > 0].tail(20000)
    d.attrs["cost"] = (float(sp.median()) * 10 ** (-dec)) if len(sp) > 100 else float(d.close.tail(5000).mean()) * 0.001
    return d

def wma(s, n):
    w = np.arange(1, n + 1)
    return s.rolling(n).apply(lambda x: np.dot(x, w) / w.sum(), raw=True)

def signals(d):
    o, h, l, c = d.open, d.high, d.low, d.close
    n = len(d); cv = c.values
    # KAMA(10, 2, 30)
    er = (c - c.shift(10)).abs() / c.diff().abs().rolling(10).sum()
    sc = ((er * (2 / 3 - 2 / 31) + 2 / 31) ** 2).values
    kama = np.full(n, np.nan); kama[0] = cv[0]
    for i in range(1, n):
        s = sc[i] if not np.isnan(sc[i]) else (2 / 31) ** 2
        kama[i] = kama[i - 1] + s * (cv[i] - kama[i - 1])
    sK = np.where((cv > kama) & (kama > np.roll(kama, 1)), 1, np.where((cv < kama) & (kama < np.roll(kama, 1)), -1, 0))
    # FRAMA(16)
    hv, lv = h.values, l.values; N = 16; half = N // 2
    fr = np.full(n, np.nan); fr[0] = cv[0]
    for i in range(1, n):
        if i < N: fr[i] = cv[i]; continue
        n1 = (hv[i - half + 1:i + 1].max() - lv[i - half + 1:i + 1].min()) / half
        n2 = (hv[i - N + 1:i - half + 1].max() - lv[i - N + 1:i - half + 1].min()) / half
        n3 = (hv[i - N + 1:i + 1].max() - lv[i - N + 1:i + 1].min()) / N
        if n1 > 0 and n2 > 0 and n3 > 0:
            D = (np.log(n1 + n2) - np.log(n3)) / np.log(2); a = float(np.clip(np.exp(-4.6 * (D - 1)), 0.01, 1.0))
        else: a = 0.5
        fr[i] = a * cv[i] + (1 - a) * fr[i - 1]
    sF = np.where((cv > fr) & (fr > np.roll(fr, 1)), 1, np.where((cv < fr) & (fr < np.roll(fr, 1)), -1, 0))
    # HMA(21)
    nn = 21; hma = wma(2 * wma(c, nn // 2) - wma(c, nn), int(np.sqrt(nn))).values
    sH = np.where((cv > hma) & (hma > np.roll(hma, 1)), 1, np.where((cv < hma) & (hma < np.roll(hma, 1)), -1, 0))
    # TSI(25, 13) with signal 7
    m = c.diff(); e1 = m.ewm(span=25, adjust=False).mean().ewm(span=13, adjust=False).mean(); e2 = m.abs().ewm(span=25, adjust=False).mean().ewm(span=13, adjust=False).mean()
    tsi = (100 * e1 / (e2 + 1e-12)); sig = tsi.ewm(span=7, adjust=False).mean()
    sT = np.where(tsi > sig, 1, np.where(tsi < sig, -1, 0))
    # Vortex(14)
    trr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    vp = (h - l.shift()).abs().rolling(14).sum() / trr.rolling(14).sum(); vm = (l - h.shift()).abs().rolling(14).sum() / trr.rolling(14).sum()
    sV = np.where(vp > vm, 1, np.where(vp < vm, -1, 0))
    # Squeeze (20, BB 2 sd, KC 1.5 ATR): fires on the bar the squeeze releases, direction = momentum sign
    basis = c.rolling(20).mean(); dev = 2 * c.rolling(20).std(ddof=0); atr20 = trr.rolling(20).mean()
    sqz = ((basis + dev) < (basis + 1.5 * atr20)) & ((basis - dev) > (basis - 1.5 * atr20))
    mid = ((h.rolling(20).max() + l.rolling(20).min()) / 2 + basis) / 2
    mom = (c - mid)
    release = (~sqz) & sqz.shift(1).fillna(False)
    sQ = np.where(release & (mom > 0), 1, np.where(release & (mom < 0), -1, 0))
    return np.column_stack([sK, sF, sH, sT, sV, sQ])

def states(d):
    c, h, l = d.close, d.high, d.low
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    a14 = tr.rolling(14).mean(); a100 = tr.rolling(100).mean()
    den = c.diff().abs().rolling(48).sum(); er = np.where(den > 0, (c - c.shift(48)).abs() / den, 0.0)
    lv = np.log(a14 / a100); ema = c.ewm(span=20, adjust=False).mean(); sl = ((ema - ema.shift(10)).abs() / a14).clip(upper=6)
    rg = ((h.rolling(24).max() - l.rolling(24).min()) / a14).clip(upper=30)
    Z = (np.column_stack([er, lv, sl, rg]) - MU) / SD; ZC = (CENT - MU) / SD
    st = np.argmin(((Z[:, None, :] - ZC[None, :, :]) ** 2).sum(2), axis=1)
    return np.where((np.arange(len(d)) >= 99) & ~np.isnan(Z).any(axis=1), st, -1), a14.values

agg = {(r, s): [] for r in range(6) for s in range(5)}; per = {(r, s): [] for r in range(6) for s in range(5)}
for f in sorted(glob.glob("E:/at24_kill/live/KX_*_H1.csv")):
    sym = os.path.basename(f).split("_")[1]
    if "XAUEUR" in sym: continue
    d = load(f); n = len(d); sg = signals(d); st, atr = states(d)
    o, h, l = d.open.values, d.high.values, d.low.values; cost = d.attrs["cost"]
    i0 = int(n * 0.6)
    for r in range(6):
        last = -10 ** 9; mine = {s: [] for s in range(5)}
        for i in range(max(i0, 250), n - HOLD - 2):
            dirn = sg[i, r]
            if dirn == 0 or st[i] < 0 or not (atr[i] > 0) or i - last < HOLD: continue
            last = i; e0 = o[i + 1]; pnl = dirn * (o[i + 1 + HOLD] - e0)
            sp = e0 - dirn * STOP * atr[i]
            for j in range(i + 1, i + 1 + HOLD):
                if (dirn > 0 and l[j] <= sp) or (dirn < 0 and h[j] >= sp): pnl = dirn * (sp - e0); break
            mine[st[i]].append((pnl - cost) / atr[i])
        for s in range(5):
            agg[(r, s)] += mine[s]
            if len(mine[s]) >= 30: per[(r, s)].append(float(np.mean(mine[s])))
    print(sym, "done", flush=True)
print("pooled average R (stop 2 ATR, 24 h hold, after spread), n, symbols positive")
for r in range(6):
    print(RULES[r].ljust(8), " | ".join(f"{NAMES[s][:6]} {np.mean(agg[(r,s)]):+.3f} n{len(agg[(r,s)])} {sum(1 for x in per[(r,s)] if x>0)}/{len(per[(r,s)])}" for s in range(5)))
json.dump({RULES[r]: {NAMES[s]: dict(avg=float(np.mean(agg[(r, s)])), n=len(agg[(r, s)]), pos=sum(1 for x in per[(r, s)] if x > 0), of=len(per[(r, s)])) for s in range(5)} for r in range(6)}, open("E:/at24_kill/rl_rnd.json", "w"), indent=1)
