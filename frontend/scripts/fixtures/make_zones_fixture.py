"""Builds scripts/fixtures/crypto-flow-zones-fixture.json: real BTCUSDT klines (1m / 5m / 15m) and one order-book snapshot
from the public Binance market-data host, plus the expected Flow Zones results computed here, independently of the TypeScript code.
Run: python make_zones_fixture.py <out.json>   (needs internet once; the validator itself is offline)."""
import json, math, sys, time, urllib.request

HOST = "https://data-api.binance.vision"
CFG = {"4h": ("1m", 1, 240, 0.05), "24h": ("5m", 5, 288, 0.1), "7d": ("15m", 15, 672, 0.25)}


def get(path):
    with urllib.request.urlopen(HOST + path, timeout=20) as r:
        return json.loads(r.read())


def floor_half(x):
    return math.floor(x + 0.5)


def zones(rows, now_ms, interval, bar_min, nbars, step_pct, book):
    bars = [r for r in rows if float(r[6]) < now_ms]
    bars = bars[-nbars:]
    last_close = float(bars[-1][4])
    last = (max(float(p) for p, _ in book["bids"]) + min(float(p) for p, _ in book["asks"])) / 2  # live book mid
    step = last_close * step_pct / 100
    mins = len(bars) * bar_min
    tpm = sum(float(r[8]) for r in bars) / mins
    prof = {}
    total = 0.0
    for r in bars:
        h, l, c, v, tb = float(r[2]), float(r[3]), float(r[4]), float(r[5]), float(r[9])
        i = floor_half((h + l + c) / 3 / step)
        b = prof.setdefault(i, [0.0, 0.0])
        b[0] += tb
        b[1] += v - tb
        total += v
    lo_i, hi_i = min(prof), max(prof)
    idxs = list(range(lo_i, hi_i + 1))
    buy = [prof.get(i, [0.0, 0.0])[0] for i in idxs]
    sell = [prof.get(i, [0.0, 0.0])[1] for i in idxs]
    vol = [a + b for a, b in zip(buy, sell)]
    poc = max(range(len(idxs)), key=lambda k: (vol[k], -k))  # largest volume, lowest index on a tie
    lo = hi = poc
    s = vol[poc]
    while s < 0.7 * total and (lo > 0 or hi < len(idxs) - 1):
        up = vol[hi + 1] if hi < len(idxs) - 1 else -1
        dn = vol[lo - 1] if lo > 0 else -1
        if up >= dn:
            hi += 1
            s += up
        else:
            lo -= 1
            s += dn
    va_low, va_high = idxs[lo] * step, idxs[hi] * step
    state = "above" if last > va_high else "below" if last < va_low else "inside"
    gap = step / 2
    buyer = seller = None
    for k in range(len(idxs)):
        p = idxs[k] * step
        net = buy[k] - sell[k]
        if p <= last - gap and net > 0 and (buyer is None or net >= buyer[1]):
            buyer = (p, net)
        if p >= last + gap and -net > 0 and (seller is None or -net > seller[1]):
            seller = (p, -net)
    out = {
        "interval": interval, "lastPrice": last, "asOf": int(bars[-1][0]), "bars": len(bars), "step": step,
        "tradesPerMinute": round(tpm), "thin": tpm < 20, "total": total,
        "buckets": len(idxs), "poc": idxs[poc] * step, "pocShare": 100 * vol[poc] / total,
        "vaLow": va_low, "vaHigh": va_high, "state": state,
        "buyer": None if buyer is None else {"price": buyer[0], "share": 100 * buyer[1] / total},
        "seller": None if seller is None else {"price": seller[0], "share": 100 * seller[1] / total},
        "profileFirst": [idxs[0] * step, buy[0], sell[0]], "profileLast": [idxs[-1] * step, buy[-1], sell[-1]],
    }
    # walls
    band = last * 0.2 / 100
    bids = [(float(p), float(q)) for p, q in book["bids"] if float(q) > 0]
    asks = [(float(p), float(q)) for p, q in book["asks"] if float(q) > 0]
    cover = min(last - min(p for p, _ in bids), max(p for p, _ in asks) - last)

    def walls(side):
        m = {}
        for p, q in side:
            k = math.floor(p / band)
            m[k] = m.get(k, 0.0) + p * q
        top = sorted(m.items(), key=lambda kv: (-kv[1], abs((kv[0] + 0.5) * band - last)))[:3]
        return [{"price": (k + 0.5) * band, "notional": n} for k, n in top]

    bs = sum(p * q for p, q in bids if p >= last - cover)
    as_ = sum(p * q for p, q in asks if p <= last + cover)
    out["book"] = {"bids": walls(bids), "asks": walls(asks), "coveragePct": 100 * cover / last, "imbalancePct": 100 * (bs - as_) / (bs + as_)}
    return out


def main():
    out_path = sys.argv[1]
    sym = "BTCUSDT"
    fx = {"symbol": sym}
    book = get(f"/api/v3/depth?symbol={sym}&limit=1000")
    klines = {}
    for lb, (iv, _, n, _) in CFG.items():
        klines[lb] = get(f"/api/v3/klines?symbol={sym}&interval={iv}&limit={n + 1}")
    now_ms = int(time.time() * 1000)
    fx["nowMs"] = now_ms
    fx["book"] = {"bids": book["bids"], "asks": book["asks"]}
    fx["klines"] = klines
    fx["expected"] = {lb: zones(klines[lb], now_ms, iv, bm, n, sp, book) for lb, (iv, bm, n, sp) in CFG.items()}
    json.dump(fx, open(out_path, "w"))
    for lb, e in fx["expected"].items():
        print(lb, e["lastPrice"], "POC", round(e["poc"], 1), "VA", round(e["vaLow"], 1), round(e["vaHigh"], 1), e["state"], "buyer", e["buyer"], "seller", e["seller"])


main()
