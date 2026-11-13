# Order flow R&D and product plan (2026-11-13)

Owner brief: research order flow, then plan an indicator or EA. Written by the indicator/research window. Evidence marked as measured by us, found on the web (weak), or not verified.

## 1. What "order flow" can mean on MT5 (it depends on the data feed)
| Feed type | What exists | Honest label |
|---|---|---|
| Exchange-traded / futures symbols with real trades (some brokers, MOEX, B3, crypto exchanges) | real volume, `TICK_FLAG_BUY` / `TICK_FLAG_SELL` on trade ticks, `MarketBook` (depth of market) | REAL delta, footprint and depth are possible |
| Forex / metals / index CFDs (most retail brokers, incl. the ones we sell to) | quote ticks (bid/ask changes), tick volume = number of quote changes, usually no aggressor flag, no depth | delta is an ESTIMATE (tick rule) or a bar-shape proxy; broker feeds also differ from each other |
| Our offline test terminal | no tick history at all (`CopyTicks` returns 4403) | cannot test tick logic offline; needs a connected rig |
Web sources agree on this split (MQL5 articles/forum: buy/sell flags only where the feed provides them; otherwise "price up = buy, price down = sell, zero tick carries the last direction" is a proxy). Vendors of footprint tools on forex use the proxy. Sources are vendor pages and forum posts, not measurements.

## 2. Measured by us today: how good are the proxies? (Binance BTCUSDT real trades, which carry the true aggressor side)
90 minutes of trades (106,169 trades, 89 one-minute bars), true delta = buyer-aggressor volume minus seller-aggressor volume:
- tick-rule delta (price up = buy, down = sell, zero tick carries the previous direction) vs true delta: correlation **0.94**, same sign **93 %** of bars;
- bar-shape proxy (bar volume x (close-open)/(high-low), what a bar-only indicator or our ProxyFlow EAs use) vs true delta: correlation **0.83**, same sign **75 %**;
- candle colour alone vs true delta sign: **75 %**;
- cumulative delta: tick-rule 0.99, bar-shape 0.96 against the true cumulative delta.
Limits: one market, one 90-minute window, real trade prints (a CFD broker's quote ticks are noisier than trade prints), one run. It says the proxies track true delta well on a liquid instrument, not that delta predicts price.

## 3. Evidence that order-flow signals make money
Not found. The practitioner material (stacked imbalances, absorption, delta divergence) is rules and anecdotes; one source itself says delta divergence away from structure is noise and stacked imbalances often continue rather than reverse. No out-of-sample, cost-aware study was found. Our own labs (01-06, C1, C2) found no tradable edge from simple price/time rules; order-flow rules are untested by us. Treat order flow as CONTEXT (who is pushing, how reliable is the move), not as a signal, until a pre-registered test says otherwise.

## 4. What we already have
- Volume Profile Levels, Cost Clock, Setup Pro / Zone Pro scorecards (price-based).
- EAs in `ea-research/lab/`: ProxyFlow_Scalper v2.20/2.21 and ProxyFootprint_Scalper v2.30 (volume spike, body %, proxy delta from bars, gold defaults). Not validated; do not sell without the owner's validation chain.
- The owner's existing MQL5 products in this area (DeltaPrint btc, Gold Footprint Alfa, CMDT Print AI, Oil Pulse): MQL5 treats near-duplicates as spam, so a new order-flow product must be clearly different (data-quality badge, scorecard) and checked against these first.

## 5. New data fact that changes the research options
Binance publishes full historical trade files for BTC/ETH (spot and futures) with the aggressor side (public data dump, since 2017). So real order flow can be researched over years for crypto without a collector. For forex/gold we only get quote-tick proxies (Dukascopy-style tick files exist but carry no aggressor side).

## 6. Product plan (honest, no signals)
1. **AT24 Flow Meter (indicator, MT5; MT4/TV ports possible for the bar-proxy mode).** Per-bar delta and cumulative delta, delta divergence marks on closed bars, and a mandatory **data-quality badge**: REAL (feed has buy/sell flags), TICK-RULE ESTIMATE (quote ticks), or BAR PROXY (no tick history available). Shows the measured accuracy of each mode from section 2. Differentiator against the many footprint tools: it says what kind of delta the user is looking at. Verification: REAL and TICK-RULE modes against Python on recorded ticks / Binance trades; BAR PROXY against Python on OHLC. Needs a connected rig for ticks.
2. **AT24 Absorption Map (indicator).** Price levels where heavy tick volume traded with little price progress, drawn as levels, with a retest scorecard on the symbol's own history (same honest scorecard pattern as Zone Pro). Works on any broker (tick volume per M1 bar).
3. **AT24 Crypto Flow (website page, not MT5).** Real BTC/ETH delta and cumulative delta from the public trade feed, 1-minute and hourly, as context next to the planned Crypto Pulse page. Real aggressor data, unlike CFD proxies.
4. **EA: none yet.** A trading EA on order-flow rules should wait for a pre-registered test on real data (crypto first, where true delta exists). If the owner wants an EA sooner, the honest option is to validate the existing ProxyFootprint scalper through the normal M2-M7 chain, not to write a new one.

## 7. Next steps (small, in this order)
- Run `ea-research/indicators/_lab/mt5/AT24_TickProbe.mq5` on a connected terminal (Engineering window's IC Markets demo): which tick flags (BUY/SELL/LAST/BID/ASK), volume and MarketBook levels each symbol class really delivers (XAUUSD, EURUSD, US500, BTCUSD). This decides which modes the Flow Meter can offer per broker.
- Build the Flow Meter BAR PROXY and TICK-RULE modes, verified against Python; add REAL mode if the probe shows buy/sell flags.
- Optional later (owner's call): one pre-registered study of delta signals on BTC/ETH real trade data (years), to see whether any order-flow rule beats luck before any EA is written.

## 8. Rules for any listing text
No profit/win-rate promises, no "institutional order flow" claims, no logic details, say ESTIMATED when the delta is an estimate, "Not financial advice"; MQL5 builds must not use WebRequest or licence gates.

## 9. Tick probe result on a real CFD feed (Engineering window, IC Markets demo, 2026-11-13)
- XAUUSD: ticks flagged BID/ASK only, no volume. EURUSD (3,499 ticks), US500 (3,881) and BTCUSD (5,000 in 2 minutes): BUY / SELL / LAST flags all 0, tick volume and real volume 0, only BID/ASK flags; `MarketBook` add succeeds on EURUSD and US500 but returns 0 levels, and fails on BTCUSD.
- Conclusion: on this broker (and, by the web evidence, on most retail forex/CFD brokers) there is no real aggressor flag, no real volume and no depth. A Flow Meter on such feeds can only offer the **tick-rule ESTIMATE** (from bid/ask changes) and the **bar proxy**; REAL delta needs an exchange-feed broker, or crypto exchange data on the website.
- Caveat for the accuracy numbers in section 2: they were measured on trade prints; a CFD feed delivers quote ticks (the tick rule would run on the mid price), which is noisier, so the real accuracy on CFDs must be measured on a recorded CFD tick stream (the ticks cannot be compared with true delta there, only with the other estimate). The badge must therefore say "ESTIMATE" and not quote the 0.94 figure as the accuracy of the CFD mode.
- Practical: tick history on CFD brokers is short (the probe needed a recent time window; a `from = 0` call returned only old cached ticks), so historical tick-based scorecards are not realistic; use bar-based (tick volume per bar) logic for anything that needs history.
