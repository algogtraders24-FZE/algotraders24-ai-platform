// scripts/update-remaining-products.ts
// M15 real /products build-out, Products #5-8: Crypto Grid Bot, NIFTY
// Algo Pro, cTrader Swing cBot, Ninja Momentum Bot. All 4 land on the
// legacy /products catalog (Prisma `Product` table) - NOT the real
// Marketplace (MarketplaceListing + M2-M7 evidence pipeline), which is
// reserved for MT5 EAs with real, evidenced backtest P&L. These are
// real, newly-written code for 4 different non-MT5 platforms
// (ccxt/Python, kiteconnect/Python, cAlgo/C#, NinjaScript/C#) that
// AT24 cannot compile or backtest from this workspace - each is
// delivered to the seller for their own compile/paper-test, per their
// explicit instruction. Descriptions are honest about that.
import "dotenv/config";
import { prisma } from "../lib/prisma";

const updates: Array<{
  slug: string;
  shortDescription: string;
  fullDescription: string;
  features: string[];
  specifications: { label: string; value: string }[];
}> = [
  {
    slug: "crypto-grid-bot",
    shortDescription: "Real ATR-sized geometric grid bot for Binance/Bybit (ccxt) with a genuine range-breakout kill switch.",
    fullDescription: `AT24 Crypto Grid Bot is a real, newly-written Python grid-trading bot built on ccxt (the standard open-source exchange library) for Binance and Bybit spot markets.

Real design choices, not decoration:
- Geometric (percentage-spaced) grid, not fixed-dollar spacing - correct for an asset that can move a large percentage, which crypto routinely does
- ATR-based grid range sizing - the range adapts to real recent volatility instead of a manually guessed band
- A genuine range-breakout kill switch: if price closes beyond the grid edge by more than a configurable %, the bot stops opening new orders and (optionally) flattens the position - this addresses the single most common way naive grid bots actually lose money (a market that stops ranging and trends hard through the grid)
- Explicit capital and exposure caps (total capital, grid levels, per-level size)

Honesty note: this has not been run against a live or paper exchange account from this workspace (no live API keys/exchange access available here). It is real, complete, runnable code - ccxt handles the actual exchange REST calls. Plug in your own API keys and paper-test/dry-run before going live.`,
    features: [
      "Geometric (%-spaced) grid across Binance or Bybit via ccxt",
      "ATR-based volatility-adaptive grid range",
      "Range-breakout kill switch with optional auto-flatten",
      "Explicit capital and exposure caps",
      "Dry-run mode for safe testing before live orders",
    ],
    specifications: [
      { label: "Platform", value: "Python (ccxt) - Binance / Bybit" },
      { label: "Type", value: "Grid trading bot (ranging markets)" },
      { label: "Tested by AT24", value: "No - real runnable code, not executed against a live/paper exchange here" },
    ],
  },
  {
    slug: "nifty-algo-pro",
    shortDescription: "Real Opening-Range-Breakout + VWAP intraday algo for NIFTY/BANKNIFTY, built on Zerodha's kiteconnect SDK.",
    fullDescription: `AT24 NIFTY Algo Pro is a real, newly-written Python intraday algorithm for NIFTY/BANKNIFTY, built against Zerodha's official kiteconnect SDK (swappable for Angel One SmartAPI or another broker with a similar order-placement surface).

Real, researched design:
- Opening Range Breakout (ORB): the first 15 minutes of the session set the range - a long-established, genuinely researched approach for Indian index intraday trading
- VWAP trend filter: breakouts are only taken in the direction VWAP itself agrees with - the single biggest real improvement over a naive ORB, cutting out a large share of false breakouts
- ATR-based SL/TP sized off real recent volatility, not a fixed point value
- A hard, time-based intraday square-off - non-negotiable for Indian intraday trading, implemented as a real forced exit
- One trade per direction per day, to avoid over-trading noise inside the same range

Honesty note: this has not been run against a live or paper broker account from this workspace (no live NSE/broker API access available here). It is real, complete strategy logic with a genuine broker integration point - plug in your own API credentials and paper-test before going live.`,
    features: [
      "15-min Opening Range Breakout entries",
      "VWAP trend-direction filter",
      "ATR-based stop-loss and take-profit",
      "Hard time-based intraday square-off",
      "One trade per direction per day",
      "Built on Zerodha's official kiteconnect SDK",
    ],
    specifications: [
      { label: "Platform", value: "Python (kiteconnect / Zerodha) - NIFTY, BANKNIFTY" },
      { label: "Type", value: "Intraday algo (ORB + VWAP)" },
      { label: "Tested by AT24", value: "No - real runnable code, not executed against a live/paper broker here" },
    ],
  },
  {
    slug: "ctrader-swing-cbot",
    shortDescription: "Real multi-timeframe EMA/ADX swing trend-follower for cTrader (cAlgo Robot, C#).",
    fullDescription: `AT24 cTrader Swing cBot is a real, newly-written cAlgo Robot (C#) implementing multi-timeframe swing trend-following. This is a deliberate, disclosed cross-platform port of the same structural design already used and real-backtested in AT24's own MQL5 EA (AT24 AI Trend Master) - reusing a sound, already-researched structure across platforms rather than inventing something new and unproven for this listing.

Logic:
- Daily EMA(50) vs EMA(200) sets the macro trend bias - only trades with it
- On the entry timeframe (H4 default): EMA(21)/EMA(55) cross in the direction of the macro bias, confirmed by ADX(14) trend strength
- RSI(14) pullback timing: enters on a pullback toward the midline rather than chasing the cross bar
- Risk: ATR-based stop, position size computed from a fixed percent-of-equity risk (not a fixed lot size), so risk stays constant in currency terms across instruments

Honesty note: this has not been compiled or run inside cTrader/cAlgo from this workspace (no cAlgo environment available here). It is written to the real cAlgo Robot API - compile and backtest it in your own cTrader/cAlgo installation before going live.`,
    features: [
      "Daily EMA(50/200) macro trend filter",
      "H4 EMA(21/55) + ADX(14) entry gate",
      "RSI(14) pullback entry timing",
      "ATR-based stop-loss, percent-of-equity position sizing",
      "Same proven structure as AT24 AI Trend Master (MT5), ported honestly",
    ],
    specifications: [
      { label: "Platform", value: "cTrader / cAlgo (C# Robot)" },
      { label: "Type", value: "Swing trend-following EA" },
      { label: "Tested by AT24", value: "No - not compiled/backtested in cAlgo here" },
    ],
  },
  {
    slug: "ninja-momentum-bot",
    shortDescription: "Real RSI + MACD-histogram momentum strategy for NinjaTrader futures, with session control and ATR risk.",
    fullDescription: `AT24 Ninja Momentum Bot is a real, newly-written NinjaScript Strategy (C#) for NinjaTrader 8 futures trading.

Logic:
- Session filter: only evaluates/enters inside a configured session window, force-flattening at session end - futures trade nearly 24 hours, and low-liquidity overnight/globex hours are a genuine, well-known source of poor fills and noisy false signals, so this is a real risk control
- Momentum bias: RSI above/below configurable levels sets a directional bias (not just an overbought/oversold read)
- Trigger: MACD histogram crossing through zero in the direction of the bias - timing entries closer to the actual momentum inflection than a raw MACD/signal-line cross
- Risk: ATR-based stop and take-profit, adapting to each instrument's real recent volatility instead of a fixed tick count

Honesty note: this has not been compiled or run inside NinjaTrader from this workspace (no NinjaTrader environment available here). It is written to the real NinjaScript Strategy API - compile it (F5 in the NinjaScript Editor) and run it through NinjaTrader's Strategy Analyzer in your own installation before going live.`,
    features: [
      "RSI directional-bias momentum filter",
      "MACD-histogram zero-cross entry trigger",
      "ATR-based stop-loss and take-profit",
      "Configurable session window with forced flatten at session end",
      "Built on the real NinjaScript Strategy API",
    ],
    specifications: [
      { label: "Platform", value: "NinjaTrader 8 (NinjaScript C#)" },
      { label: "Type", value: "Momentum strategy (futures)" },
      { label: "Tested by AT24", value: "No - not compiled/backtested in NinjaTrader here" },
    ],
  },
];

async function main() {
  for (const u of updates) {
    const result = await prisma.product.updateMany({
      where: { slug: u.slug, deletedAt: null },
      data: {
        shortDescription: u.shortDescription,
        fullDescription: u.fullDescription,
        features: u.features,
        specifications: u.specifications,
        version: "1.0.0-untested",
        rating: 0,
        downloads: 0,
      },
    });
    console.log(`${u.slug}: rows updated = ${result.count}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
