"""Builds scripts/fixtures/crypto-flow-derivatives-fixture.json: real Binance USDS-M futures responses for BTCUSDT and ETHUSDT
(premium index, funding info, 25 hourly open-interest points, long/short ratios) plus the expected results computed here,
independently of the TypeScript code. Run: python make_derivatives_fixture.py <out.json> (internet needed once)."""
import json, sys, urllib.request

H = "https://fapi.binance.com"


def get(p):
    with urllib.request.urlopen(H + p, timeout=20) as r:
        return json.loads(r.read())


def regime(oi, px):
    if abs(oi) < 1 or abs(px) < 0.2:
        return "flat"
    if oi > 0:
        return "new longs" if px > 0 else "new shorts"
    return "short covering" if px > 0 else "long unwinding"


def label(a):
    if abs(a) < 5:
        return "neutral"
    if a > 0:
        return "longs paying a lot" if a >= 20 else "longs paying"
    return "shorts paying a lot" if abs(a) >= 20 else "shorts paying"


def crowd(s):
    return "long-heavy" if s >= 0.6 else "short-heavy" if s <= 0.4 else "balanced"


premium = get("/fapi/v1/premiumIndex")
info = get("/fapi/v1/fundingInfo")
syms = ["BTCUSDT", "ETHUSDT"]
fx = {"premium": [p for p in premium if p["symbol"] in syms], "fundingInfo": info, "symbols": {}, "expected": {}}
for s in syms:
    oi = get(f"/futures/data/openInterestHist?symbol={s}&period=1h&limit=25")
    acc = get(f"/futures/data/globalLongShortAccountRatio?symbol={s}&period=1h&limit=2")
    top = get(f"/futures/data/topLongShortPositionRatio?symbol={s}&period=1h&limit=2")
    tk = get(f"/futures/data/takerlongshortRatio?symbol={s}&period=1h&limit=2")
    fx["symbols"][s] = {"oi": oi, "acc": acc, "top": top, "taker": tk}
    pts = sorted(({"t": int(r["timestamp"]), "oi": float(r["sumOpenInterest"]), "v": float(r["sumOpenInterestValue"])} for r in oi), key=lambda r: r["t"])
    for p in pts:
        p["px"] = p["v"] / p["oi"]
    out = {"n": len(pts), "oiNow": pts[-1]["oi"], "usd": pts[-1]["v"]}
    for hrs in (4, 24):
        a, b = pts[-1 - hrs], pts[-1]
        oc, pc = 100 * (b["oi"] - a["oi"]) / a["oi"], 100 * (b["px"] - a["px"]) / a["px"]
        out[f"h{hrs}"] = {"oi": oc, "px": pc, "regime": regime(oc, pc)}
    prem = next(p for p in premium if p["symbol"] == s)
    iv = next((float(i["fundingIntervalHours"]) for i in info if i["symbol"] == s), 8.0)
    rate = float(prem["lastFundingRate"])
    ann = rate * (24 / iv) * 365 * 100
    out["funding"] = {"pct": rate * 100, "interval": iv, "annual": ann, "label": label(ann), "mark": float(prem["markPrice"])}
    out["acc"] = {"long": float(acc[-1]["longAccount"]) * 100, "crowd": crowd(float(acc[-1]["longAccount"]))}
    out["top"] = {"long": float(top[-1]["longAccount"]) * 100, "crowd": crowd(float(top[-1]["longAccount"]))}
    out["taker"] = float(tk[-1]["buySellRatio"])
    fx["expected"][s] = out
json.dump(fx, open(sys.argv[1], "w"))
print(json.dumps(fx["expected"], indent=1)[:1200])
