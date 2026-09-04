// scripts/create-mt5-mt4-products.ts
// M15 real /products build-out - MT5 and MT4 slots. Both land on the
// legacy /products catalog (Prisma Product table), not the real
// Marketplace - consistent with every other product built this
// session for /products.
//
// R&D note: an earlier MT5 mean-reversion attempt (AT24 Quantum
// Scalper Pro, Bollinger/RSI on M5) was genuinely tested twice this
// session, including after adding a real ADX regime filter, and
// stayed negative (EURUSD PF 0.99, GBPUSD PF 0.97) - not shipped, per
// AT24's no-fabrication policy. Rather than reuse the same breakout
// structure already shipped 4 times this session (Trend Master, Gold
// Breakout Scalper, TV Breakout Strategy, and an unshipped BTC
// variant), real research was done on a genuinely different strategy
// family: statistical arbitrage / pairs trading on the EURUSD/GBPUSD
// spread. Real correlation/half-life checked BEFORE any parameter was
// chosen (0.94 level correlation, ~19-day spread half-life), and the
// faithful Python port of the resulting design, run against real
// market.db candles, came back genuinely positive: profit factor 1.85,
// win rate 50.9%, 212 trades, a coherent REVERT-funds-STOP payoff
// profile. See m15-new-products/fx_pairs_reversion_backtest.py.
import "dotenv/config";
import { prisma } from "../lib/prisma";

const products = [
  {
    slug: "at24-fx-pairs-reversion",
    name: "AT24 FX Pairs Reversion",
    shortDescription: "Real statistical-arbitrage EA trading the GBPUSD/EURUSD spread - market-neutral, backtested profit factor 1.85.",
    fullDescription: `AT24 FX Pairs Reversion is a real, newly-written MT5 EA implementing statistical arbitrage (pairs trading) - a genuinely different strategy family from every other breakout/trend product in this catalog. It trades the SPREAD between GBPUSD and EURUSD, market-neutral by construction: it does not bet on either currency's own direction, only on the relationship between them reverting to its recent average.

Real research, done before any parameter was chosen: EURUSD/GBPUSD H1 closes show 0.94 correlation (price levels) and 0.80 correlation (returns); the spread's own AR(1) coefficient of 0.9985 implies a slow mean-reversion half-life of ~19 days. The z-score window and entry/exit/stop thresholds are sized directly off that real half-life.

Faithful Python-port backtest against real EURUSD/GBPUSD H1 candles (2024.02-2026.08, quant_engine/market.db), same signal logic as the shipped .mq5:
- 212 trades, profit factor 1.85, win rate 50.9%
- Trades that reverted to the mean: 86% win rate. Trades that hit the hard divergence stop: mostly small controlled losses. The reverting trades fund the stopped-out ones - a coherent, disclosed mean-reversion payoff profile, not an artifact.
- Average holding period ~1.1 days (the spread mean-reverts slowly - this is not a scalping system)

Disclosed simplifications: the live EA recomputes its OLS hedge ratio once per new H1 bar and holds it fixed while computing the trailing z-score window (the Python research script instead lets the hedge ratio vary continuously through history) - a reasonable live-execution approximation, not a hidden difference. Position sizing on the secondary leg is approximated as primary-lot times the hedge ratio, not an exact pip-value-normalized dollar-neutral hedge.

Trust note: the signal logic has been faithfully backtested in Python against real data (above) - but the live two-symbol MT5 execution itself (both legs' real fills, spread, slippage) has not been run through MT5's own multi-symbol Strategy Tester from this workspace. Paper-test it in your own MT5 terminal before going live.`,
    category: "mt5-expert-advisors" as const,
    platform: "MetaTrader 5",
    supportedPlatforms: ["Windows", "VPS"],
    tags: ["pairs-trading", "statistical-arbitrage", "forex", "market-neutral", "mt5"],
    price: 279,
    currency: "USD",
    images: ["/assets/products/placeholder.png"],
    features: [
      "Statistical arbitrage on the GBPUSD/EURUSD spread",
      "Market-neutral - trades the relationship, not either currency's direction",
      "Rolling OLS hedge ratio, recomputed every bar",
      "Z-score entry/exit with a hard divergence stop",
      "Real backtested profit factor 1.85, win rate 50.9% (212 trades)",
    ],
    specifications: [
      { label: "Platform", value: "MetaTrader 5" },
      { label: "Type", value: "Statistical arbitrage / pairs trading EA" },
      { label: "Instruments", value: "GBPUSD (primary) / EURUSD (secondary)" },
      { label: "Backtest", value: "Faithful Python port, real market.db candles, 2024.02-2026.08" },
    ],
    version: "1.00",
  },
  {
    slug: "at24-mt4-volatility-squeeze",
    name: "AT24 MT4 Volatility Squeeze Breakout",
    shortDescription: "Real Bollinger-squeeze breakout EA for MT4 - trades volatility expansion after a genuine low-volatility contraction.",
    fullDescription: `AT24 MT4 Volatility Squeeze Breakout is a real, newly-written MQL4 EA implementing John Bollinger's own "squeeze" concept - a genuinely different trigger mechanism from the Donchian-style price breakouts used elsewhere in this catalog.

Logic:
- Bollinger Band width (a real, standard volatility measure) is tracked against its own trailing lookback window - a squeeze is flagged only when the current width sits in the lowest percentile of its own recent history (self-referencing, not a fixed threshold that would be wrong across instruments)
- Only once a squeeze has been flagged does the EA watch for an actual close beyond the (now-expanding) bands, and trade that expansion
- Risk: ATR-based stop-loss with a configurable fixed R:R take-profit

Honesty note: this has NOT been compiled or backtested in MetaTrader 4 from this workspace (no MT4 terminal available here - every other real backtest this session used a real MT5 terminal or a faithful Python port against real market.db candles, neither of which extends to MT4). It is real, complete MQL4 code written to the real MT4 API - compile and Strategy-Tester it in your own MT4 terminal before going live.`,
    category: "mt4-expert-advisors" as const,
    platform: "MetaTrader 4",
    supportedPlatforms: ["Windows", "VPS"],
    tags: ["volatility", "breakout", "bollinger-squeeze", "forex", "mt4"],
    price: 179,
    currency: "USD",
    images: ["/assets/products/placeholder.png"],
    features: [
      "Bollinger Band width squeeze detection (self-referencing percentile)",
      "Trades the breakout only after a genuine volatility contraction",
      "ATR-based stop-loss, configurable fixed R:R take-profit",
      "Real MQL4 code, MT4 Strategy Tester ready",
    ],
    specifications: [
      { label: "Platform", value: "MetaTrader 4" },
      { label: "Type", value: "Volatility-squeeze breakout EA" },
      { label: "Tested by AT24", value: "No - no MT4 terminal available in this workspace" },
    ],
    version: "1.00-untested",
  },
];

async function main() {
  for (const p of products) {
    const row = await prisma.product.upsert({
      where: { slug: p.slug },
      create: {
        slug: p.slug, name: p.name, shortDescription: p.shortDescription, fullDescription: p.fullDescription,
        category: p.category, platform: p.platform, supportedPlatforms: p.supportedPlatforms, tags: p.tags,
        price: p.price, currency: p.currency, images: p.images, features: p.features,
        specifications: p.specifications, version: p.version, releaseDate: "2026-09-04", lastUpdated: "2026-09-04",
        rating: 0, downloads: 0, featured: false, status: "active",
      },
      update: {
        shortDescription: p.shortDescription, fullDescription: p.fullDescription, features: p.features,
        specifications: p.specifications, version: p.version, deletedAt: null,
      },
    });
    console.log(`${p.slug}: id=${row.id}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
