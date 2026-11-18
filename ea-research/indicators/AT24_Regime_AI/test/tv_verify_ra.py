import numpy as np, pandas as pd
MU = np.array([0.163863, -0.031967, 1.014311, 5.525808]); SD = np.array([0.119898, 0.26684, 0.766584, 1.932356])
CENT = np.array([[0.1023, 0.1663, 0.6141, 4.3468], [0.1219, -0.2405, 1.3098, 7.4327], [0.3395, -0.1325, 2.6010, 9.4282], [0.1197, -0.2249, 0.4958, 4.6743], [0.2955, 0.1396, 1.5741, 5.6380]])
NAMES = ["NOISY", "WIDE SWING", "STRONG MOVE", "COMPRESSED", "STEADY TREND"]
d = pd.read_csv("tv_btc_h1.csv"); n = len(d)
h, l, c = d.high, d.low, d.close
tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
a14 = tr.rolling(14).mean(); a100 = tr.rolling(100).mean()
den = c.diff().abs().rolling(48).sum()
er = np.where(den > 0, (c - c.shift(48)).abs() / den, 0.0)
lv = np.log(a14 / a100)
ema = c.ewm(span=20, adjust=False).mean()
sl = ((ema - ema.shift(10)).abs() / a14).clip(upper=6)
rg = ((h.rolling(24).max() - l.rolling(24).min()) / a14).clip(upper=30)
Z = (np.column_stack([er, lv, sl, rg]) - MU) / SD; ZC = (CENT - MU) / SD
st = np.argmin(((Z[:, None, :] - ZC[None, :, :]) ** 2).sum(2), axis=1)
valid = (np.arange(n) >= 99) & ~np.isnan(Z).any(axis=1)
st = np.where(valid, st, -1)
fr = np.full(n, -1.0)
hv, lvv = h.values, l.values
for i in range(99, n - 24):
    if st[i] >= 0 and a14.iloc[i] > 0: fr[i] = (hv[i + 1:i + 25].max() - lvv[i + 1:i + 25].min()) / a14.iloc[i]
cnt = np.zeros(5); cnf = np.zeros(5); cs = np.zeros(5); stay = np.zeros(5); trn = np.zeros(5); runs = np.zeros(5)
tot = 0; sumall = 0.0; nall = 0; prev = -1
for i in range(99, n):
    s = st[i]
    if s < 0: prev = -1; continue
    cnt[s] += 1; tot += 1
    if fr[i] >= 0: cnf[s] += 1; cs[s] += fr[i]; sumall += fr[i]; nall += 1
    if i + 1 < n and st[i + 1] >= 0:
        trn[s] += 1; stay[s] += int(st[i + 1] == s)
    if prev != s: runs[s] += 1
    prev = s
allf = sumall / nall
run = 1
while st[n - 1 - run] == st[n - 1]: run += 1
print("state", NAMES[st[n - 1]], "for", run, "bars, stays", round(stay[st[n-1]] / trn[st[n-1]] * 100))
for q in range(5):
    print(f"{NAMES[q]:13s} share {cnt[q]/tot*100:.0f}%  meanrun {cnt[q]/runs[q]:.1f}  stays {stay[q]/trn[q]*100:.0f}%  ratio x{(cs[q]/cnf[q])/allf:.2f} (n {int(cnf[q])})")
# range model
FIRST = 150
trs = tr.values; cs_ = np.concatenate([[0], np.cumsum(trs)])
def avg(i, w): return (cs_[i + 1] - cs_[i + 1 - w]) / w
close = c.values; f = np.zeros((n, 3)); ok = np.zeros(n, bool); y = np.zeros(n); yok = np.zeros(n, bool)
for i in range(FIRST, n):
    A14, A24, A120 = avg(i, 14), avg(i, 24), avg(i, 120)
    f[i] = np.log([A14 / close[i], A24 / close[i], A120 / close[i]]); ok[i] = True
    if i + 24 <= n - 1:
        r_ = (hv[i + 1:i + 25].max() - lvv[i + 1:i + 25].min()) / close[i]
        if r_ > 0: y[i] = np.log(r_); yok[i] = True
hr = ((d.t.values % 86400) // 3600).astype(int)
def fit(a, b, minn=1500):
    rows = np.array([i for i in range(a, b + 1) if ok[i] and yok[i]])
    if len(rows) < minn: return None
    ym = y[rows].mean(); sea = np.array([y[rows][hr[rows] == k].mean() if (hr[rows] == k).any() else ym for k in range(24)])
    X = np.column_stack([f[rows], sea[hr[rows]]]); m = X.mean(0); s = X.std(0) + 1e-12; Zr = (X - m) / s
    w = np.linalg.solve(Zr.T @ Zr + np.eye(4), Zr.T @ (y[rows] - ym)); res = y[rows] - (Zr @ w + ym)
    return dict(sea=sea, ym=ym, m=m, s=s, w=w, q=np.quantile(res, [0.1, 0.5, 0.9]), n=len(rows))
def pred(M, i):
    x = np.array([f[i, 0], f[i, 1], f[i, 2], M["sea"][hr[i]]]); return float(((x - M["m"]) / M["s"]) @ M["w"] + M["ym"])
a0, b0 = 150, n - 1 - 24
fin = fit(a0, b0); p = pred(fin, n - 1); px = close[n - 1]
mid, lo, hi = px * np.exp(p + fin["q"][1]), px * np.exp(p + fin["q"][0]), px * np.exp(p + fin["q"][2])
sp = a0 + int(0.7 * (b0 - a0)); tf = fit(a0, sp - 48); inn = mm = 0
for i in range(sp, b0 + 1):
    if ok[i] and yok[i]:
        pp = pred(tf, i); mm += 1; inn += int(pp + tf["q"][0] - 1e-12 <= y[i] <= pp + tf["q"][2] + 1e-12)
print(f"range ~ {mid:.2f} ({mid/px*100:.2f} %)  band {lo:.2f} - {hi:.2f}  held {inn/mm*100:.0f} %  rows {fin['n']}")
