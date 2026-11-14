# Crypto Flow: which instruments can we take from Binance? (R&D, 2026-11-14)

Owner question: besides BTC and ETH, which instruments can the Crypto Flow page show (top 10 coins, XAUUSDT, PAXGUSDT)? All numbers below were measured today from Binance's free public market data (no key), the same source the page already uses.

## 1. What the free feed gives per instrument
Both the spot and the USDⓈ-M futures 1-minute klines carry the taker-buy volume (buyer-aggressor volume) and the number of trades, so a REAL buyer/seller delta is available for every instrument below, with no estimate. Hosts: spot `data-api.binance.vision` (already used by the page and confirmed reachable from our deployment), futures `fapi.binance.com` (reachable from here; reachability from the Vercel region is NOT verified, Binance restricts some countries).

## 2. Top 10 coins (market-cap order, USDT pairs on Binance spot; stablecoins and non-Binance coins skipped)
| Coin | 24 h volume on Binance spot | Verdict |
|---|---|---|
| BTC | 1,551 M USD (5.2 M trades) | high liquidity |
| ETH | 570 M (2.5 M trades) | high |
| SOL | 274 M (0.8 M trades) | high |
| XRP | 116 M (0.56 M trades) | high |
| BNB | 96 M (0.75 M trades) | high |
| HYPE | 41 M (0.20 M trades) | medium |
| DOGE | 32 M (0.39 M trades) | medium |
| LINK | 22 M (0.25 M trades) | medium |
| TRX | 20 M (55 k trades) | medium / thin-ish |
| ADA | 17 M (102 k trades) | medium |
By market cap the list is BTC, ETH, USDT, BNB, USDC, XRP, SOL, TRX, (a tokenised-loan asset), HYPE, ZEC, XMR, DOGE...; USDT/USDC are stablecoins (no flow story), LEO and WBT are not on Binance. Big Binance volume that is NOT in the market-cap top 10: ZEC (173 M), NEAR (84 M), tokenised US stocks (e.g. NVDAB 144 M).

## 3. Gold and metals (the interesting part)
| Instrument | Where | 24 h volume | Median trades per minute (last 4 h) | Empty minutes (of 240) | Verdict |
|---|---|---|---|---|---|
| **XAUUSDT** | **USDⓈ-M perpetual futures** (it does NOT exist on spot) | **1,398 M USD, 1.18 M trades** | **111** | **0** | real gold flow, liquid |
| XAGUSDT (silver) | perpetual futures | (similar class) | 37 | 0 | usable |
| PAXGUSDT | spot (gold-backed token) | 9.7 M USD, 28 k trades | **4** | **24** | **thin**: few trades, delta very noisy |
| XAUTUSDT | spot (gold-backed token) | 14 M USD, 29 k trades | 5 | 24 | thin |
Also on the futures side: XPTUSDT (platinum), XPDUSDT (palladium) and tokenised-equity perpetuals (TSLA, AMZN, MSTR, COIN, PLTR, INTC, HOOD, CRCL). Spot also lists tokenised stocks (NVDAB, SPCXB, SOXLB).
Findings: for gold, the **XAUUSDT perpetual** is the instrument to use (its price 3,884 tracked spot gold; 1.4 B USD a day, about 28 times the volume of PAXG), PAXG should be offered only with a "thin" warning. Caveats: a perpetual is a leveraged derivative, not physical gold; it also trades on weekends when spot gold is closed; its flow shows what Binance traders did, not the whole gold market.

## 4. Data-quality badge (so users know how much to trust a delta)
Median trades per minute over the last 4 hours: 100 or more = HIGH; 20 to 100 = MEDIUM (XAGUSDT, thin alts); below 20, or many empty minutes = THIN (PAXG, XAUT). THIN gets a visible warning ("few trades: delta is noisy"); the bias badge is hidden for THIN instruments.

## 5. Page design proposal
- Overview table: one row per instrument (price, 1 h buyers %, bias badge, quality badge); click a row for the meter, windows and chart already built for BTC/ETH.
- Groups: Crypto (top 10), Gold and metals (XAUUSDT perp, XAGUSDT perp, PAXGUSDT spot marked thin).
- Cost: one 241-bar klines request per instrument per 30-second cache window, shared by all users; 10 to 12 requests per window, Binance weight 2 each (limit 6,000 per minute per IP), no database.
- Wording: descriptive only, "what already traded on Binance", not a signal.

## 6. Plan
- **Phase A (safe now)**: spot instruments (top 10 coins + PAXGUSDT with the thin warning) on the same host as today; add the instrument table, the quality badge and the per-coin detail.
- **Phase B (after a reachability test)**: futures instruments (XAUUSDT, XAGUSDT, optionally platinum/palladium). The provider should try the futures host and, if it fails from the deployment region, show the instrument as "temporarily unavailable" instead of an error for the whole page. A fallback host is not available for futures klines (the data-vision mirror is spot only), so if the Tokyo region is blocked we would need another region or a small relay (owner decision).
- Later idea (MT5 side): the XAUUSDT perpetual flow next to the broker's XAUUSD chart is the only real gold order flow we can get for free; the MT5 Flow Meter (estimate) could show it as a cross-check, but MT5 cannot call external hosts, so it stays a website feature.
