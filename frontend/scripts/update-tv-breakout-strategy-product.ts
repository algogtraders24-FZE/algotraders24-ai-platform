// scripts/update-tv-breakout-strategy-product.ts
// M15 real /products build-out, Product #4: TV Breakout Strategy
// (slug: tv-breakout-strategy). Unlike an indicator, a Pine strategy()
// script produces its own real, quantified backtest the moment it is
// loaded on a TradingView chart (net profit, profit factor, win rate,
// drawdown) - via TradingView's own Strategy Tester, run by the seller
// in their own account (no TradingView environment available here).
// This script updates the legacy /products Product row with an honest
// description of the real, newly-written Pine Script v5 code
// (ea-research/marketplace-research/m15-new-products/source/
// AT24_TV_Breakout_Strategy.pine) and zeroes the previously-fabricated
// rating/downloads fields.
import "dotenv/config";
import { prisma } from "../lib/prisma";

const SLUG = "tv-breakout-strategy";

const fullDescription = `AT24 TV Breakout Strategy is a real, newly-written Pine Script v5 strategy() implementing a Donchian-channel breakout system - the same core edge behind the classic "Turtle Trading" system: trading a genuine break of the N-bar high/low, not an arbitrary indicator crossover.

How it trades:
- Entry: close breaks above the highest high (long) or below the lowest low (short) of the last N bars (default 20)
- Optional higher-timeframe EMA trend filter, to cut down counter-trend whipsaws in choppy ranges (on by default, configurable timeframe and length)
- Risk: ATR-based initial stop, with a choice of a fixed R:R take-profit OR an ATR chandelier trailing exit
- A minimum-ATR-percent filter to skip dead/illiquid conditions

Because this is a Pine strategy() (not a plain indicator), TradingView's own Strategy Tester computes a real, quantified backtest - net profit, profit factor, win rate, max drawdown - the moment you load it on a chart. AT24 has not run that backtest here (no TradingView environment available in this workspace), so no performance numbers are claimed in this listing. Run it in your own TradingView account, on your own instrument/timeframe/date range, and judge the real Strategy Tester output before relying on it live.`;

async function main() {
  const updated = await prisma.product.updateMany({
    where: { slug: SLUG, deletedAt: null },
    data: {
      shortDescription: "Real Donchian-channel breakout strategy for TradingView, with ATR risk management and an optional HTF trend filter.",
      fullDescription,
      features: [
        "Donchian-channel (N-bar high/low) breakout entries",
        "Optional higher-timeframe EMA trend filter",
        "ATR-based initial stop-loss",
        "Configurable fixed R:R take-profit OR ATR chandelier trailing exit",
        "Minimum-volatility filter to skip dead markets",
        "Runs in TradingView's own Strategy Tester - real backtest results on load",
      ],
      specifications: [
        { label: "Platform", value: "TradingView (Pine Script v5 strategy)" },
        { label: "Type", value: "Strategy (backtestable in TradingView's Strategy Tester)" },
        { label: "Tested by AT24", value: "No - written to Pine v5 spec, not compiled/run in TradingView here" },
      ],
      version: "1.0.0-untested",
      rating: 0,
      downloads: 0,
    },
  });
  console.log("Rows updated:", updated.count);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
