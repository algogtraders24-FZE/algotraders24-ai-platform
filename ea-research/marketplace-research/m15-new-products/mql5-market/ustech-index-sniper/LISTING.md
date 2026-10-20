# USTECH Index Sniper - MQL5 Market submission kit (v1.02)

Everything below is copy-paste ready for the MQL5 Market "Add product" form.
Files in this folder: `USTECHIndexSniper.mq5` (source to publish; compiled with MetaEditor: 0 errors, 0 warnings), `icon-200x200.png`,
`banner-1600x500.png` (optional promo image), `screenshots/01..04` (1280x720).

## Product fields

| Field | Value |
|---|---|
| Name | USTECH Index Sniper |
| Type | Expert Advisor (MetaTrader 5) |
| Version | 1.02 |
| Symbol / timeframe | US Tech 100 index (USTEC / NAS100 / US100 ... the name depends on the broker). The EA works on M1 bars internally - attach it to a chart of the index. Other symbols: see AutoAdaptSymbol below |
| Logo | `icon-200x200.png` |
| Screenshots | `screenshots/01-balance-curve.png`, `02-profit-by-month.png`, `03-how-it-trades.png`, `04-default-settings.png` |
| Price | your choice (the AT24 marketplace price is 2,999 USD; MQL5 Market sets its own fee/pricing rules) |
| Demo version | tick "Allow demo" if you want buyers to try it in the tester (no licence code is needed in this build) |

## Short description (one line)

US Tech 100 scalper: M5 trend + fair value gap, one precise pending order at a time, break-even and trailing exit, built-in risk-based lot sizing.

## Full description (paste as is)

USTECH Index Sniper trades trend continuation on the US Tech 100 index with ONE precise pending order at a time.

HOW IT WORKS
After every closed M1 bar the EA looks for two things at once: an M5 EMA(50) trend (price on the right side of a rising or falling EMA) and a fresh 3-candle fair value gap of at least 8 pips in the same direction. When both agree it places a single buy-stop or sell-stop just beyond the high/low of the last 5 M1 bars (30 points buffer), with a fixed stop loss and take profit, and cancels the order if it is not triggered within 3 minutes. There is never more than one position or pending order, with a 30-second cooldown between orders. Open trades are managed on every tick: once a trade is 100 points (1.00 index point) in profit the stop moves to break-even + 20 points and a fixed trailing stop 10 pips (0.10 index point) behind the price follows it, so most trades close within a few minutes. It only trades inside the London and New York sessions and only when the spread is acceptable. Optional filters (CVD pressure proxy, entropy/volatility regime, tick order-flow) are included and switched OFF by default, exactly as in the tested run.

BACKTEST RESULTS (Strategy Tester, Exness symbol USTEC_x100, M1, first trade 2025-06-16, last trade 2026-09-10, 14,893 trades, 100,000 USD deposit, risk-based lot 2% per trade)
- Net profit 36,680,484: the lot grows with the balance, so profit compounds (the lot grew from 0.4 to the symbol's 20-lot maximum). Profit factor 1.76, win rate 94.6% of trades net winners (97.4% before commission), average trade +2,463.
- The profit came in June-December 2025 (+40.8 million). January-September 2026 was NEGATIVE (-4.1 million) with 6 losing months out of 9. Recent behaviour of the tested settings is weaker than the headline.
- Loss shape: the average losing trade (about -41,275) was about 8 times the average winner (+4,969); the largest single loss was about 731,000. The longest winning streak was 200 trades and the longest losing streak 3.
- Maximum drawdown 11.28% on closed trades and 11.46% on a rebuilt intraday equity curve (real 15-minute candles); the longest drawdown lasted about 250 days and equity has not recovered its late-2025 peak. The tester report also prints a 100% equity drawdown which could not be reproduced or explained. A 15-minute curve cannot see swings inside a trade shorter than one bar, so real intratrade drawdown can be larger.
- Only 43% of the test ticks were real ticks; commission is visible in the deals, the spread model is unknown. This is a backtest, not live trading: no live results are claimed.

READ BEFORE USING
- The default inputs reproduce the tested distances and exits: stop loss 5000 pips, take profit 11000 pips, break-even / trailing in POINTS (UsePipsForTrailing = false). "Pips" in this EA are 0.01 price units, so 5000 pips = a 50-point move and 11000 pips = 110 points on the index. The points inputs depend on your broker's digits: tested on a 2-digit index quote (1 point = 0.01); on a 1-digit quote the distances are different and behaviour will differ.
- The test ran on an Exness index symbol with a contract size of 100 (one lot = 100 USD per index point, 20-lot maximum). Lot sizes, profits and drawdown amounts therefore do NOT transfer to other brokers, whose index contracts are usually much smaller; only the risk-based sizing (a percentage of equity per trade) carries over.
- RISK: the test used 2% risk per trade with compounding. By default this build uses 0.5% risk. That is still a high-risk scalper: a few losing trades can erase many small wins. Results and drawdown scale with risk. Choose a size that is right for YOUR account, and start on a demo account.
- A scalper with trades of a few minutes is very sensitive to spread, slippage, execution speed, commission and the broker's stop level. Live results can be very different from the backtest.
- Designed and tested on a US Tech 100 index only. On other symbols the input AutoAdaptSymbol (default true) scales every distance by price / 21700 so the EA can run at all; those symbols are NOT backtested - leave it on the index for the tested behaviour, or set AutoAdaptSymbol = false to use the raw index distances.
- Session hours (London 7-16, New York 12-21) are BROKER SERVER time, tested on Exness. Check your broker's server-time offset. Index symbols are named differently by brokers (USTEC, NAS100, US100 ...): check digits and PipSize (default 0.01).
- Past performance is not a guarantee of future results. Trading leveraged products is risky; this is not financial advice.

SETUP
1. Attach the EA to a chart of the US Tech 100 index and allow Algo Trading.
2. Leave the defaults for the tested behaviour, or set your own risk (RiskPercent) / fixed lot (UseRiskLot = false, FixedLot).
3. Check the session hours against your broker's server time.

## What's new (version 1.02)

Second fix for the Market validation report ("failed cancel order ... order or position being close to market" on EURUSD H1). On symbols other than the US Tech index the EA now leaves a pending order alone while its price is closer to the market than a safe distance (the larger of the broker's stops / freeze level and 0.3% of the price) and cancels it normally once the price has moved away or it has filled. Trailing-stop changes follow the same rule, and a refused cancel is retried only after two minutes. Trading rules, inputs and defaults are unchanged; on the US Tech index the behaviour is identical to the tested run.

(1.01 - respected the reported freeze level; 1.00 - first release.)

## Pre-flight checklist (before pressing Publish)

1. Copy `USTECHIndexSniper.mq5` into `MQL5\Experts` of your MetaTrader 5 and compile in MetaEditor (expect 0 errors, 0 warnings).
2. MetaEditor > File > "Publish product" (or the Market tab) > fill the fields above, upload icon + screenshots, publish.
3. The Market validator tests EURUSD / GBPUSD / XAUUSD on several timeframes with default inputs and rejects an EA that makes no
   trades or that has failed trade operations. This build scales distances to the symbol (AutoAdaptSymbol), uses a price-relative spread
   limit on non-index symbols and (v1.02) never cancels / modifies an order or stop that is too close to the market. v1.00 and v1.01
   each returned 21 "failed cancel order ... Modification failed due to order or position being close to market" errors on EURUSD H1
   (the validator's symbol reports a freeze level of 0 but still refuses the request, so v1.02 uses a wider safe distance). v1.02 was NOT
   run through the Market validator or the strategy tester locally - if the report still lists errors, send the exact message again.
4. Do not mention other websites, prices or contact details in the description (Market rules); the text above already avoids them.
5. Version numbers must increase on every update; upload this as 1.02 (the earlier uploads were 1.00 and 1.01) and fill "What's new".
