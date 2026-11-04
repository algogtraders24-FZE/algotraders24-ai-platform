AT24 Universal EA v7.03  -  Expert Advisor for XAUUSD (gold), MetaTrader 5
=========================================================================
Algotraders24 AI  |  https://www.algotraders24.ai

FILES
  UniversalEA.ex5                    the Expert Advisor (licence-protected)
  UniversalEA_tested_settings.set    the EXACT inputs of the Strategy Tester run the marketplace evidence is based on

WHAT IT DOES
  A pending-order breakout EA. When it is flat and the session is open (08:00-20:00 server time, no new entries on Friday
  late, never on weekends) it places a BUY STOP above and a SELL STOP below the price, each at max(2 x ATR(14), 1.2 x the
  stop-loss distance, 1.5 x the broker's minimum stop distance), each side only when an EMA(50) trend filter agrees.
  Every order has a fixed 500-point stop loss and no take profit. An open trade moves to break-even once it is 400 points in
  profit and is then trailed 300 points behind the price. If a trade is stopped out at a loss, the EA opens ONE opposite
  trade at market (a "reversal", same lot and stop distance). Filters: spread (50 points), a daily loss limit (100 USD),
  session hours. One position at a time. A chart dashboard shows the state (never shown in the Strategy Tester unless
  you switch it on).

LICENCE KEY (required)
  Your key is on your AT24 purchase page (Dashboard > Purchases > this product > "Your licence key").
  1. MetaTrader 5: Tools > Options > Expert Advisors > tick "Allow WebRequest for listed URL" and add
        https://www.algotraders24.ai
  2. Attach the EA to an XAUUSD chart (M5 as tested), Allow Algo Trading, paste the key into InpLicenseKey.
  One key works on ONE trading account at a time and only for this product. To move it: Dashboard > Purchases > this
  product > "Change trading account" (2 changes per 30 days). The EA checks the key at start and every 4 hours; if it is
  revoked or used on another account it stops opening NEW trades and removes its pending orders (open trades are still
  managed). A short internet outage never stops a running EA (72 hours of grace). The Strategy Tester needs no key.

IMPORTANT - READ BEFORE USING
  * The marketplace evidence comes from the seller's own Strategy Tester report (ICMarketsSC-Demo, XAUUSD M5, 2025.09.01 -
  2026.10.27, real ticks, 1,000 USD deposit, FIXED lot 0.05, 2,639 trades, net profit 9,358, profit factor 1.33, win
  rate 57%). AT24 recomputed every figure from the report and rebuilt the equity path from real candles; AT24 did not
  re-run the EA.
  * The tested settings are NOT the EA's defaults. In the test the trend filter was ON (default OFF), break-even trigger
  400 (default 300), trailing distance 300 (default 400) and the lot was 0.05 (default 0.01). Load UniversalEA_tested_settings.set
  to reproduce the evidence; other settings have NOT been tested.
  * 0.05 lot on a 1,000 USD account is a HIGH-risk setting. The report's own equity drawdown is 54%; the equity path
  rebuilt from real M15 candles gives a deepest drawdown of about 71% of the equity at its peak, and the equity was below
  its previous peak for about three quarters of the period. Scale the lot to your account - drawdown and profit scale
  with it.
  * The result is uneven: 2025 (Sep-Dec) made only about +1,100 (worst month November 2025, about -360) while 2026 made
  about +8,250 (best month March 2026, about +2,525). One of 14 months was negative.
  * The report shows ZERO commission. A real account that charges commission pays more than the test did. Spread and
  slippage depend on your broker; the tester used real ticks of one demo account.
  * Session hours and the "points" inputs depend on your broker's server time and digits (tested on a 2-digit gold
  quote: 1 point = 0.01 USD).
  * Start on a DEMO account with a small lot. Past performance is not a guarantee of future results. Trading leveraged
  products is risky; this is not financial advice.

SUPPORT: https://www.algotraders24.ai  (dashboard > Support)
