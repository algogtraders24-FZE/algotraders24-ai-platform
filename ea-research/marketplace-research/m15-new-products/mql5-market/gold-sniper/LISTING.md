# Gold Sniper - MQL5 Market submission kit (v1.01)

Everything below is copy-paste ready for the MQL5 Market "Add product" form.
Files in this folder: `GoldSniper.mq5` (source to publish), `GoldSniper.ex5` (compiled, 0 errors / 0 warnings), `icon-200x200.png`,
`banner-1600x500.png` (optional promo image), `screenshots/01..04` (1280x720).

## Product fields

| Field | Value |
|---|---|
| Name | Gold Sniper |
| Type | Expert Advisor (MetaTrader 5) |
| Version | 1.01 |
| Symbol / timeframe | XAUUSD (the EA works on M1 bars internally - attach to any chart of XAUUSD). Other symbols: see AutoAdaptSymbol below |
| Logo | `icon-200x200.png` |
| Screenshots | `screenshots/01-balance-curve.png`, `02-profit-by-month.png`, `03-how-it-trades.png`, `04-default-settings.png` |
| Price | your choice (the AT24 marketplace price is 999 USD; MQL5 Market sets its own fee/pricing rules) |
| Demo version | tick "Allow demo" if you want buyers to try it in the tester (no licence code is needed in this build) |

## Short description (one line)

XAUUSD scalper: M5 trend + fair value gap, one precise pending order at a time, break-even and trailing exit.

## Full description (paste as is)

Gold Sniper trades trend continuation on gold (XAUUSD) with ONE precise pending order at a time.

HOW IT WORKS
After every closed M1 bar the EA looks for two things at once: an M5 EMA(50) trend (price on the right side of a rising or falling EMA) and a fresh 3-candle fair value gap of at least 8 pips in the same direction. When both agree it places a single buy-stop or sell-stop just beyond the high/low of the last 5 M1 bars (30 points buffer), with a fixed stop loss and take profit, and cancels the order if it is not triggered within 3 minutes. There is never more than one position or pending order, with a 30-second cooldown between orders. Open trades are managed on every tick by a break-even rule and a fixed-distance trailing stop. It only trades inside the London and New York sessions and only when the spread is acceptable. Optional filters (CVD pressure proxy, entropy/volatility regime, tick order-flow) are included and switched OFF by default, exactly as in the tested run.

BACKTEST RESULTS (Strategy Tester, Exness XAUUSD, M1, 2025-01-06 to 2026-10-08, 539 trades, 100,000 USD deposit, FIXED 1.0 lot, seller's own report)
- Net profit 264,229.78, profit factor 1.28, win rate 52.5%, average trade +490, largest loss -11,056, longest losing streak 9.
- Maximum drawdown on closed trades (balance): 66,245 = 25.84%. The report also prints a 100% equity drawdown which could not be verified or explained - intraday drawdown is not independently verified.
- Uneven: 2025 +124,780, 2026 so far +139,450. The best month (October 2025, +93,867) made 35.5% of the total profit; 9 of 22 months were losing months.
- Only 43% of the test ticks were real ticks; the spread model is unknown. This is a backtest, not live trading: no live results are claimed.

READ BEFORE USING
- The default inputs reproduce the tested distances: stop loss 5000 pips, take profit 20000 pips, break-even 10000/9000, trailing 3000/1000. "Pips" in this EA are 0.01 price units, so 5000 pips = a 50.00 USD move and 20000 pips = 200.00 USD.
- LOT SIZE: the test used a fixed 1.0 lot (100 oz). By default this build sizes the lot from risk (0.5% of equity per trade). At 1.0 lot a 50 USD stop risks about 5,000 USD, at 0.01 lot about 50 USD. Results and drawdown scale with lot size. Choose a size that is right for YOUR account, and start on a demo account.
- The largest single loss in the test (-11,056) was more than twice what the stop implies; the report does not explain why (slippage or a price gap is the usual cause).
- Designed and tested on XAUUSD only. On other symbols the input AutoAdaptSymbol (default true) scales every distance by price / 2500 so the EA can run at all; those symbols are NOT backtested - leave it on XAUUSD for the tested behaviour, or set AutoAdaptSymbol = false to use the raw gold distances.
- Session hours (London 7-16, New York 12-21) are BROKER SERVER time, tested on Exness. Check your broker's server-time offset. Symbols are named differently by brokers (XAUUSD, XAUUSDm, GOLD ...): check digits and PipSize (default 0.01).
- Pending-order EAs on gold are sensitive to spread, slippage and stop level around news. A VPS and a low-spread account are recommended.
- Past performance is not a guarantee of future results. Trading leveraged products is risky; this is not financial advice.

SETUP
1. Attach the EA to an XAUUSD chart and allow Algo Trading.
2. Leave the defaults for the tested behaviour, or set your own risk (RiskPercent) / fixed lot (UseRiskLot = false, FixedLot).
3. Check the session hours against your broker's server time.

## What's new (version 1.01)

Fix for the Market validation ("no trading operations" on EURUSD / GBPUSD / XAUUSD tests): the EA now adapts all distances and the spread limit to the symbol's price scale (new input AutoAdaptSymbol, default true; XAUUSD behaviour is unchanged), so it also places orders on non-gold symbols. Spread filter is now scale-independent.

(Version 1.00 - first release.)

## Pre-flight checklist (before pressing Publish)

1. Copy `GoldSniper.mq5` into `MQL5\Experts` of your MetaTrader 5 and compile in MetaEditor (expect 0 errors, 0 warnings).
2. MetaEditor > File > "Publish product" (or the Market tab) > fill the fields above, upload icon + screenshots, publish.
3. v1.01 fixes the v1.00 validator result ("there are no trading operations" on EURUSD H1, XAUUSD D1, GBPUSD M30, EURUSD M1) by scaling
   distances to the symbol on non-gold symbols. It was NOT run through the Market validator or the strategy tester locally - if the
   report still lists a symbol with no trades, send me the exact message.
4. Do not mention other websites, prices or contact details in the description (Market rules); the text above already avoids them.
5. Version numbers must increase on every update (1.01, 1.10 ...); fill "What's new" each time.
