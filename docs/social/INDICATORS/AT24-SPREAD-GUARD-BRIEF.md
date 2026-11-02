# AT24 Spread Guard - marketing brief (indicator #2)

**Name:** AT24 Spread Guard  **Tagline:** See what trading costs, hour by hour.
**Platforms:** MT5, MT4, TradingView (TradingView edition = range-based, see below). **Type:** context/cost indicator, no signals.
**Assets:** `ea-research/indicators/AT24_Spread_Guard/branding/` (logo_400.png, logo_200.png, banner_1200x630.png, screenshot_mt5.png). Own shield logo.
**Source:** `ea-research/indicators/AT24_Spread_Guard/{mt5,mt4,tradingview}`

## What it shows
- Live spread now vs the typical spread for this GMT hour, status NORMAL / ELEVATED / SPIKE
- Spread as % of ATR(14) with a HIGH COST warning
- 3 cheapest and 3 costliest hours (GMT)
- 24-hour mini chart of the hourly spread profile (gold bar = current hour)
- Coloured spread histogram + typical-hour line in a sub-window
- Optional alert when the spread spikes
- Learns the profile from YOUR broker's live spread over time (works even when the broker's history spread is flat)

## Honest claims you MAY make
- Profile maths verified against an independent Python calculation (4e-7 difference).
- Compiles clean on MT5 and MT4; verified on a live MT5 gold chart (screenshot provided).
- Real finding you can share: some brokers' stored history shows the same spread at every hour, so we built a live-learning profile instead of trusting history.
- Gold fact from our own research: with ~30 points of cost, M1 gold gives away about half the risk unit to costs and M5 about a quarter.

## Claims you must NOT make
- No claim that trading in cheap hours makes money. It lowers cost; it is not a signal or an edge.
- TradingView cannot read spreads: that edition uses average bar range per UTC hour and the spread you type in. Say so.
- Verified: TradingView edition compiles and renders (`branding/screenshot_tradingview.jpg`).
- Not yet verified: MT4 version on a chart (compiles clean; manual look needed).

## Mandatory footer text
"Context tool. Not a signal. Past conditions do not predict future results. Not financial advice. algotraders24.ai"
