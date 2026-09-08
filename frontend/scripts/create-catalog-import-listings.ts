// scripts/create-catalog-import-listings.ts
// Sprint M14 (bulk catalog import) - creates real DRAFT MarketplaceListing
// rows + real PUBLISHED ReleaseArtifact rows (real compiled .ex5 binaries,
// sha256-hashed, stored in private-releases/ - same convention as
// register-releases.ts) for 16 pre-existing EAs/indicators found in the
// seller's own "algotraders24 AI" folder, with their own real banners,
// icons, and product-description text (reused verbatim/condensed from
// their own BBCode/MQL5-listing files - real seller-authored copy, not
// invented here).
//
// IMPORTANT - stays DRAFT on purpose, same reasoning as M12's very first
// PDHPDL intake before its evidence chain existed: none of these 16
// products has any real M2-M7 Evidence/Validation/Risk chain (no MT5
// Strategy Tester report was found anywhere in the source folder - only
// marketing copy and compiled binaries). trustState is set to the real,
// honest "UNVERIFIED" (not left blank, not upgraded) - which the real
// v2 eligibility gate (services/marketplace/factory/eligibility.ts)
// correctly REJECTS for publication (TRUST_STATUS_BLOCKED), by design.
// These listings will only ever go live for real once each product gets
// a real backtest report run through the real M2-M7 pipeline (same work
// this session already did for AT24 Gold Range Breaker and Gold Fire v5),
// or an explicit, documented pre-launch override decision, matching this
// program's established pattern - never done silently here.
import "dotenv/config";
import { readFile, mkdir, copyFile, writeFile } from "fs/promises";
import { createHash } from "crypto";
import path from "path";
import { prisma } from "../lib/prisma";

const SELLER_EMAIL = "algogtraders24@gmail.com";
const CATALOG_ROOT = path.join(__dirname, "..", "..", "ea-research", "marketplace-research", "m14-catalog-import");
const RELEASES_DIR = path.join(__dirname, "..", "private-releases");

interface CatalogProduct {
  slug: string;
  title: string;
  tradingSystemId: string;
  versionId: string;
  artifactVersion: string;
  description: string;
  category: string;
  platformTag: string;
  assetTag: string;
  tags: string[];
  price: number | null; // null = free
  ex5File: string; // filename inside m14-catalog-import/source/
  hasBanner: boolean;
}

const PRODUCTS: CatalogProduct[] = [
  {
    slug: "at24-axon-24", title: "AXON 24", tradingSystemId: "AXON-24", versionId: "AXON-24-v1.07-2026-07-03", artifactVersion: "v1.07",
    description: "AXON 24 trades up to 7 major forex pairs (EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, USDCHF, NZDUSD) from one chart, scored by an 8-factor engine (trend, momentum, strength, volatility). One clean position per pair, fixed Stop Loss / Take Profit - no martingale, no grid, no averaging. Includes a live on-chart dashboard, an M15 confirmation filter, an economic-news trading pause, and a daily per-symbol trade cap.\n\nWorks on any broker's symbol naming. Recommended: H1 chart, hedging account, 500+ USD deposit, VPS for uninterrupted multi-pair trading. Always test on demo first.",
    category: "Momentum", platformTag: "MT5", assetTag: "Forex", tags: ["forex", "multi-pair", "neural-engine", "mt5"], price: 49,
    ex5File: "AXON_24.ex5", hasBanner: true,
  },
  {
    slug: "at24-axon-pro-26", title: "AXON PRO 26", tradingSystemId: "AXON-PRO-26", versionId: "AXON-PRO-26-v1.07-2026-07-03", artifactVersion: "v1.07",
    description: "AXON PRO 26 auto-detects and trades up to 26 forex majors and crosses from a single chart, using the same 8-factor neural-score engine as AXON 24, scaled to a full portfolio view. One clean position per pair, fixed SL/TP, a global drawdown limit, and a free-margin check before every order.\n\nWorks on any broker's symbol naming, with an optional custom pair list. Includes the same M15 confirmation filter, news pause, and daily trade cap as the rest of the AT24 EA family.",
    category: "Momentum", platformTag: "MT5", assetTag: "Forex", tags: ["forex", "multi-pair", "neural-engine", "mt5", "portfolio"], price: 79,
    ex5File: "AXON_PRO_26.ex5", hasBanner: true,
  },
  {
    slug: "at24-global-commodity-matrix", title: "Global Commodity Matrix", tradingSystemId: "GLOBAL-COMMODITY-MATRIX", versionId: "GLOBAL-COMMODITY-MATRIX-v1.62-2026-07-03", artifactVersion: "v1.62",
    description: "One engine, four commodity markets. Global Commodity Matrix auto-detects which instrument it's attached to - Gold (XAUUSD), Silver (XAGUSD), Crude Oil (USOIL/WTI), or Bitcoin (BTCUSD) - and loads a tuned, ATR-based stop/target/drawdown profile for that specific market, rather than one generic setting for all four.\n\nSame 8-factor scoring engine as the rest of the AT24 family: one clean position at a time, fixed SL/TP, no martingale or grid. The dashboard's \"Active Matrix Profile\" panel shows exactly which tuning is currently loaded.",
    category: "Momentum", platformTag: "MT5", assetTag: "Gold", tags: ["gold", "silver", "oil", "bitcoin", "multi-asset", "mt5"], price: 79,
    ex5File: "GLOBAL_COMMODITY_MATRIX.ex5", hasBanner: false,
  },
  {
    slug: "at24-nexusmining-exploration-algo", title: "Nexusmining Exploration Algo", tradingSystemId: "NEXUSMINING-EXPLORATION-ALGO", versionId: "NEXUSMINING-EXPLORATION-ALGO-v1.26-2026-07-03", artifactVersion: "v1.26",
    description: "A dedicated Crude Oil (USOIL/WTI) Expert Advisor - one market, traded with the discipline of an algorithm: fixed Stop Loss/Take Profit, no martingale, no grid, no averaging in.\n\nPart of the AT24 EA family's shared v1.x feature set: an M15 confirmation filter, an economic-news trading pause, and a daily trade cap.",
    category: "Momentum", platformTag: "MT5", assetTag: "Oil", tags: ["oil", "usoil", "wti", "mt5"], price: 49,
    ex5File: "NEXUSMINING_EXPLORATION_ALGO.ex5", hasBanner: false,
  },
  {
    slug: "at24-quantumtech-nas", title: "QuantumTech NAS", tradingSystemId: "QUANTUMTECH-NAS", versionId: "QUANTUMTECH-NAS-v1.06-2026-07-03", artifactVersion: "v1.06",
    description: "A dedicated NAS100 (Nasdaq 100) Expert Advisor. Stops, targets and filters are sized for index-point swings rather than forex pips, using the same 8-factor trend/momentum/strength/volatility scoring as the rest of the AT24 family. Includes an optional Smart Risk Scaling that trims position size after a losing streak and restores it on recovery.\n\nAuto-detects your broker's own naming for the Nasdaq 100 (USTEC, US100, NAS100, NDX100, NASDAQ100) - use the cash/spot symbol, not the dated futures contract.",
    category: "Momentum", platformTag: "MT5", assetTag: "Indices", tags: ["nas100", "nasdaq", "indices", "mt5"], price: 49,
    ex5File: "QUANTUMTECH_NAS.ex5", hasBanner: true,
  },
  {
    slug: "at24-quantum-gold-ai", title: "Quantum Gold AI", tradingSystemId: "QUANTUM-GOLD-AI", versionId: "QUANTUM-GOLD-AI-v1.37-2026-07-03", artifactVersion: "v1.37",
    description: "A dedicated Gold (XAUUSD) Expert Advisor built on a multi-indicator decision engine that scores market conditions and only trades when several signals agree. One clean position at a time, fixed Stop Loss/Take Profit - no martingale, no grid, no reckless averaging.",
    category: "Momentum", platformTag: "MT5", assetTag: "Gold", tags: ["gold", "xauusd", "mt5"], price: 49,
    ex5File: "QUANTUM_GOLD_AI.ex5", hasBanner: false,
  },
  {
    slug: "at24-quantum-index-engine", title: "Quantum Index Engine", tradingSystemId: "QUANTUM-INDEX-ENGINE", versionId: "QUANTUM-INDEX-ENGINE-v1.07-2026-07-03", artifactVersion: "v1.07",
    description: "Auto-detects and trades six major world stock indices from one chart - US30 (Dow Jones), NAS100 (Nasdaq), SPX500 (S&P 500), GER40 (DAX), UK100 (FTSE) and JP225 (Nikkei) - each with its own tuned stop/target profile, since each index has a different price scale and volatility character.\n\nSame 8-factor scoring engine as the rest of the AT24 family: one clean position per index, fixed SL/TP, a global drawdown limit, free-margin check before every order.",
    category: "Momentum", platformTag: "MT5", assetTag: "Indices", tags: ["indices", "us30", "nas100", "spx500", "dax", "ftse", "nikkei", "mt5"], price: 79,
    ex5File: "QUANTUM_INDEX_ENGINE.ex5", hasBanner: true,
  },
  {
    slug: "at24-quantum-wallstreet-pro", title: "Quantum WallStreet Pro", tradingSystemId: "QUANTUM-WALLSTREET-PRO", versionId: "QUANTUM-WALLSTREET-PRO-v1.07-2026-07-03", artifactVersion: "v1.07",
    description: "Trades the top 25 most liquid US stocks from one chart - AAPL, MSFT, NVDA, AMZN, GOOGL, META, TSLA, AMD, JPM, and more - auto-detected at your broker, each position sized from its own volatility so a $30 stock and a $900 stock are both handled correctly.\n\nEvaluates momentum, trend quality, and price behavior before entering a trade, aiming to remove emotional/manual decision-making from stock trading.",
    category: "Momentum", platformTag: "MT5", assetTag: "Stocks", tags: ["stocks", "us-stocks", "aapl", "nvda", "tsla", "mt5"], price: 99,
    ex5File: "QUANTUM_WALLSTREET_PRO.ex5", hasBanner: true,
  },
  {
    slug: "at24-quantumpulse-btc", title: "QuantumPulse BTC", tradingSystemId: "QUANTUMPULSE-BTC", versionId: "QUANTUMPULSE-BTC-v1.26-2026-07-03", artifactVersion: "v1.26",
    description: "A dedicated Bitcoin (BTCUSD) Expert Advisor - one market, traded with fixed Stop Loss/Take Profit discipline, no martingale, no grid, no chasing noise.",
    category: "Momentum", platformTag: "MT5", assetTag: "Crypto", tags: ["bitcoin", "btcusd", "crypto", "mt5"], price: 49,
    ex5File: "QuantumPulse_BTC.ex5", hasBanner: false,
  },
  {
    slug: "at24-silver-mining-algo", title: "Silver Mining Algo", tradingSystemId: "SILVER-MINING-ALGO", versionId: "SILVER-MINING-ALGO-v1.25-2026-07-03", artifactVersion: "v1.25",
    description: "A dedicated Silver (XAGUSD) Expert Advisor, part of the AT24 EA family's shared v1.x feature set: an M15 confirmation filter, an economic-news trading pause, and a daily trade cap. One clean position at a time, fixed Stop Loss/Take Profit.",
    category: "Momentum", platformTag: "MT5", assetTag: "Silver", tags: ["silver", "xagusd", "mt5"], price: 49,
    ex5File: "SILVER_MINING_ALGO.ex5", hasBanner: false,
  },
  {
    slug: "at24-cmdt-print-ai", title: "CMDT-Print AI", tradingSystemId: "CMDT-PRINT-AI", versionId: "CMDT-PRINT-AI-v1.0-ASIS", artifactVersion: "v1.0",
    description: "An order-flow Expert Advisor covering four markets from one engine - Gold (XAUUSD), Silver (XAGUSD), Crude Oil (USOIL/WTI) and Bitcoin (BTCUSD). Instead of lagging indicators, it reads real tick buy/sell volume (order-flow delta) - the balance of aggressive buyers vs. sellers - with a candle-based fallback when tick data isn't available.\n\nAuto-detects the chart symbol and applies the matching risk profile. Three SL/TP modes (Account Dollars, Price Move, or ATR), a per-symbol risk profile, a hard per-trade risk cap, and a spread filter. Includes an interactive on-chart panel with manual Buy/Sell/Close and a live dashboard.",
    category: "Liquidity", platformTag: "MT5", assetTag: "Gold", tags: ["order-flow", "gold", "silver", "oil", "bitcoin", "multi-asset", "mt5"], price: 59,
    ex5File: "CMDT-Print_AI.ex5", hasBanner: true,
  },
  {
    slug: "at24-gold-footprint-alpha", title: "Gold Footprint Alpha", tradingSystemId: "GOLD-FOOTPRINT-ALPHA", versionId: "GOLD-FOOTPRINT-ALPHA-v1.0-ASIS", artifactVersion: "v1.0",
    description: "An order-flow Expert Advisor dedicated to Gold (XAUUSD) on M5. Reads real tick buy/sell volume (order-flow delta) rather than lagging indicators, with a candle-based fallback when tick data is unavailable - trading the divergences and momentum shifts that appear before price reacts.\n\nOpens a position only when order-flow delta, candle direction, and a volume spike all align. Three SL/TP modes, auto or fixed lot sizing, a spread filter with spread built into the stop distance, and an interactive on-chart panel.",
    category: "Liquidity", platformTag: "MT5", assetTag: "Gold", tags: ["order-flow", "gold", "xauusd", "mt5"], price: 39,
    ex5File: "GoldFootprintAlpha.ex5", hasBanner: true,
  },
  {
    slug: "at24-oil-pulse-expert", title: "Oil Pulse Expert", tradingSystemId: "OIL-PULSE-EXPERT", versionId: "OIL-PULSE-EXPERT-v1.0-ASIS", artifactVersion: "v1.0",
    description: "An order-flow Expert Advisor dedicated to Crude Oil (USOIL/WTI) on M5 - the same real tick buy/sell delta engine as Gold Footprint Alpha, with a candle-based fallback when tick data is unavailable.\n\nOpens a position only when order-flow delta, candle direction, and a volume spike all align. Three SL/TP modes, auto or fixed lot sizing, a spread filter, and an interactive on-chart panel.",
    category: "Liquidity", platformTag: "MT5", assetTag: "Oil", tags: ["order-flow", "oil", "usoil", "wti", "mt5"], price: 39,
    ex5File: "OilPulseExpert.ex5", hasBanner: true,
  },
  {
    slug: "at24-pivot-scanner-pro", title: "Pivot Scanner Pro", tradingSystemId: "PIVOT-SCANNER-PRO", versionId: "PIVOT-SCANNER-PRO-v1.0-ASIS", artifactVersion: "v1.0",
    description: "A free, multi-symbol multi-timeframe (M15/H1/H4/D1) dashboard indicator - not an auto-trading EA. Shows a BUY/SELL signal (EMA 9/21 crossover confirmed by the daily pivot), trend direction, and pivot side for every symbol/timeframe at a glance; rows glow when all selected timeframes agree.\n\nClick any cell to instantly open that symbol/timeframe with pivot levels (P/R1-3/S1-3) and EMA 9/21 lines drawn automatically. Works on any broker - just match your symbol names.",
    category: "Trend", platformTag: "MT5", assetTag: "Forex", tags: ["indicator", "scanner", "pivot", "ema", "free", "mt5"], price: null,
    ex5File: "PivotScannerPro.ex5", hasBanner: false,
  },
  {
    slug: "at24-deltaprint-btc", title: "DeltaPrint BTC", tradingSystemId: "DELTAPRINT-BTC", versionId: "DELTAPRINT-BTC-v1.0-ASIS", artifactVersion: "v1.0",
    description: "An order-flow Expert Advisor for Bitcoin (BTCUSD), part of the DeltaPrint order-flow EA family (see DeltaPrint BTC Pro for the higher tier). No detailed product write-up exists yet for this specific version - the seller should complete a full description before this listing is submitted for review.",
    category: "Liquidity", platformTag: "MT5", assetTag: "Crypto", tags: ["order-flow", "bitcoin", "btcusd", "crypto", "mt5"], price: 39,
    ex5File: "DeltaPrintBTC.ex5", hasBanner: true,
  },
  {
    slug: "at24-deltaprint-btc-pro", title: "DeltaPrint BTC Pro", tradingSystemId: "DELTAPRINT-BTC-PRO", versionId: "DELTAPRINT-BTC-PRO-v1.0-ASIS", artifactVersion: "v1.0",
    description: "The Pro tier of the DeltaPrint Bitcoin (BTCUSD) order-flow Expert Advisor family. No detailed product write-up exists yet for this specific version - the seller should complete a full description (what differs from the standard DeltaPrint BTC) before this listing is submitted for review.",
    category: "Liquidity", platformTag: "MT5", assetTag: "Crypto", tags: ["order-flow", "bitcoin", "btcusd", "crypto", "pro", "mt5"], price: 59,
    ex5File: "DeltaPrint_BTC_Pro.ex5", hasBanner: true,
  },
];

async function main() {
  const seller = await prisma.user.findFirst({ where: { email: SELLER_EMAIL }, select: { id: true } });
  if (!seller) throw new Error(`No User found for ${SELLER_EMAIL}`);
  await mkdir(RELEASES_DIR, { recursive: true });

  for (const p of PRODUCTS) {
    const ex5Path = path.join(CATALOG_ROOT, "source", p.ex5File);
    const bytes = await readFile(ex5Path);
    const artifactHash = createHash("sha256").update(bytes).digest("hex");

    const release = await prisma.releaseArtifact.upsert({
      where: { tradingSystemId_versionId_platform_artifactHash: { tradingSystemId: p.tradingSystemId, versionId: p.versionId, platform: p.platformTag, artifactHash } },
      create: { tradingSystemId: p.tradingSystemId, versionId: p.versionId, platform: p.platformTag, artifactVersion: p.artifactVersion, artifactHash, releaseStatus: "PUBLISHED" },
      update: { releaseStatus: "PUBLISHED" },
    });
    await writeFile(path.join(RELEASES_DIR, `${release.id}.ex5`), bytes);
    await writeFile(path.join(RELEASES_DIR, `${release.id}.filename.txt`), `${p.title.replace(/\s+/g, "_")}.ex5`, "utf-8");

    const listing = await prisma.marketplaceListing.upsert({
      where: { slug: p.slug },
      create: {
        sellerId: seller.id, slug: p.slug, title: p.title, description: p.description,
        media: [], pricing: p.price == null ? { model: "free" } : { model: "one_time", amount: p.price, currency: "USD" },
        category: p.category, platformTag: p.platformTag, assetTag: p.assetTag, tags: p.tags,
        tradingSystemId: p.tradingSystemId, versionId: p.versionId,
        trustState: "UNVERIFIED", trustReasonCode: "NO_EVIDENCE_SUBMITTED", trustExplanation: "No AT24 Evidence has been submitted for this product yet - real backtest evidence is required before this Trust State can change.",
        publicationState: "DRAFT",
      },
      update: { description: p.description, category: p.category, assetTag: p.assetTag, tags: p.tags },
    });

    const mediaDir = path.join(__dirname, "..", "public", "marketplace", listing.id);
    await mkdir(mediaDir, { recursive: true });
    await copyFile(path.join(CATALOG_ROOT, "branding", p.slug.replace(/^at24-/, ""), "icon.png"), path.join(mediaDir, "icon.png"));
    const media = [`/marketplace/${listing.id}/icon.png`];
    if (p.hasBanner) {
      await copyFile(path.join(CATALOG_ROOT, "branding", p.slug.replace(/^at24-/, ""), "banner.png"), path.join(mediaDir, "banner.png"));
      media.push(`/marketplace/${listing.id}/banner.png`);
    }
    await prisma.marketplaceListing.update({ where: { id: listing.id }, data: { media } });

    console.log(`${p.title}: listingId=${listing.id} releaseId=${release.id} publicationState=DRAFT trustState=UNVERIFIED`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
