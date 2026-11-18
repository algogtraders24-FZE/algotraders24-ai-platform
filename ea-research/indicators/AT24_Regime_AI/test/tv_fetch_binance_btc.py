import urllib.request, json, time, datetime as dt, numpy as np, pandas as pd, sys
now = int(time.time() * 1000)
last_open = (now // 3600000) * 3600000 - 3600000        # last closed 1h bar open time (UTC)
rows = []; end = last_open
for _ in range(9):
    u = f"https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=1000&endTime={end}"
    d = json.load(urllib.request.urlopen(u, timeout=30))
    if not d: break
    rows = d + rows; end = d[0][0] - 1
    if len(rows) >= 7719: break
rows = rows[-7719:]
df = pd.DataFrame(rows).iloc[:, :6]; df.columns = ["t", "open", "high", "low", "close", "vol"]
for c in ("open", "high", "low", "close"): df[c] = df[c].astype(float)
df["t"] = df.t // 1000
print("bars", len(df), "last closed bar open (UTC)", dt.datetime.utcfromtimestamp(df.t.iloc[-1]))
df.to_csv("tv_btc_h1.csv", index=False)
