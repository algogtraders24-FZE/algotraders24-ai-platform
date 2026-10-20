Gold Sniper v1.00  -  XAUUSD M1 pending-stop trend-continuation EA for MetaTrader 5
=================================================================
Algotraders24 AI  |  https://www.algotraders24.ai

FILES IN THIS DOWNLOAD
  GoldSniper.ex5                    the Expert Advisor
  GoldSniper_tested_settings.set    the EXACT inputs of the backtest the marketplace evidence is based on

LICENCE KEY (required)
  Your key is on your AT24 purchase page (Dashboard > Purchases > this product > "Your licence key").
  1. MetaTrader 5: Tools > Options > Expert Advisors > tick "Allow WebRequest for listed URL" and add
        https://www.algotraders24.ai
  2. Attach the EA, open the Inputs tab, load the settings file (Load > GoldSniper_tested_settings.set), THEN paste the key into
     InpLicenseKey (loading a settings file afterwards would not remove it, but paste it last to be safe).
  One key works on ONE trading account at a time (and only for this product). Moving to another broker/account or VPS:
  Dashboard > Purchases > this product > "Change trading account" (2 changes per 30 days), then run the EA there.
  The EA checks the key when it starts and every 4 hours. If the key is revoked, belongs to another product or is
  used on another account, the EA stops placing NEW orders; positions that are already open are still managed.
  A short internet outage never stops a running EA (72 hours of grace).
  The Strategy Tester needs no key, so you can still backtest the EA.

INSTALL (3 minutes)
 1. MetaTrader 5: File > Open Data Folder > MQL5 > Experts: copy GoldSniper.ex5 there (refresh the Navigator).
 2. Open an XAUUSD chart (any timeframe - the EA works on M1 bars internally) and drag GoldSniper onto it. Allow Algo Trading.
 3. Inputs tab > Load > GoldSniper_tested_settings.set to reproduce the tested configuration, paste your licence key, then set
    RiskPercent to a risk that is right for your account (see below).

HOW IT TRADES
  Only inside the London and New York sessions (hours in BROKER SERVER time, inputs LondonStartHour...NewYorkEndHour), with an
  acceptable spread. After each closed M1 bar it needs an M5 EMA(50) trend (price on the right side of a rising/falling EMA) and a fresh
  3-candle fair value gap of at least 8 pips (0.08 USD) in the same direction. It then places ONE buy-stop / sell-stop just beyond the last 5 M1
  bars' high/low (30 points buffer, cancelled after 3 minutes), with a fixed pip stop loss and take profit. One position or pending
  order at a time, 30 seconds cooldown.
  Exits in the tested settings (UsePipsForTrailing=false): once a trade is 100 points (1.00 USD on a 2-digit gold quote) in profit the stop
  moves to break-even + 20 points, and a fixed trailing stop 10 pips (0.10 USD) behind the price follows it in steps of at least 20 points.
  Trades are therefore often closed within seconds. Optional filters in the code (CVD pressure proxy, entropy/volatility regime, tick
  order-flow) were OFF in the tested run.

IMPORTANT - READ BEFORE USING
 * THE TESTED SETTINGS DIFFER FROM THE EA DEFAULTS: the backtest used StopLossPips=5000, TakeProfitPips=11000, RiskPercent=2 (risk-based lot),
   UsePipsForTrailing=false and the CVD / regime / order-flow filters OFF. The EA's built-in defaults are different (StopLossPips=50,
   TakeProfitPips=100, RiskPercent=0.5, UsePipsForTrailing=true, all filters ON). Use the .set file to get the tested behaviour;
   other settings have NOT been backtested.
 * "PIPS" ARE 0.01 PRICE UNITS (PipSize=0.01): StopLossPips=5000 is a 50.00 USD move, TakeProfitPips=11000 a 110.00 USD move.
   The break-even / trailing inputs in this configuration are in POINTS of your broker's quote: the test used a 2-digit gold quote
   (1 point = 0.01 USD). On a broker with 3-digit gold (1 point = 0.001) the same inputs mean ten times smaller distances and the
   behaviour will differ - check your digits.
 * LOT SIZE / COMPOUNDING: the backtest sized every trade at 2 percent risk of the equity (lots between 0.39 and 4.16 on a 100,000 USD
   start), so the lot grows with the balance and profit compounds. That is a high risk setting: the largest single loss in the test was
   25,753 USD, the closed-trade drawdown 25.26 percent, and the longest losing streak 11 trades. Choose a risk that is right for you
   (for example RiskPercent=0.5 or lower) - results and drawdown scale with it.
 * THE RESULT FADED IN 2026: in the test 2025 made +769,619 (8,995 trades) while 2026 (to 9 October) lost -91,442 (7,527 trades);
   8 of 22 months were losing months, the worst was April 2026 (-57,445) and the best month made 34.7 percent of all profit.
 * VERY SHORT TRADES: the median trade lasted about 13 seconds and there were 16,522 trades. Such a scalper depends heavily on spread,
   slippage, execution speed and the broker's stop level. The tested run used 43 percent real ticks; spread/commission/swap models are
   not disclosed by the report. Live results can be very different from the backtest.
 * DRAWDOWN: the report prints a balance drawdown of 25.26 percent and an EQUITY drawdown of 100 percent. AT24 rebuilt the equity curve
   from real XAUUSD M15 candles between each trade's entry and exit: maximum equity drawdown 25.33 percent (263,906), longest drawdown
   about 189 days. The 100 percent figure is NOT reproduced and stays unexplained; a tick-level low can still differ from the candle curve.
 * SERVER TIME: session hours are BROKER SERVER time. The test ran on Exness; check your own broker's server-time offset and adjust the hours.
 * SYMBOL: tested on Exness "XAUUSD". Other brokers name it XAUUSD.m / GOLD / XAUUSDm etc.; check PipSize and digits.
 * Start on a DEMO account. Past performance is not a guarantee of future results. Trading leveraged products is risky;
   this is not financial advice.

SUPPORT: https://www.algotraders24.ai  (dashboard > Support)
