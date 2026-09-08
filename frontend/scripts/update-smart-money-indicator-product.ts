// scripts/update-smart-money-indicator-product.ts
// M15 real /products build-out, Product #3: Smart Money Indicator
// (slug: smart-money-indicator). This is a TradingView Pine Script
// INDICATOR (visual structure overlay), not an EA with its own P&L,
// so it does not go through the Marketplace evidence/trust pipeline
// (M2-M7) - that pipeline scores trading-system backtests, and an
// indicator has no trades of its own to evidence. Instead this script
// updates the legacy /products Product row directly: replaces the
// previously-fabricated marketing copy with an honest description of
// the real, newly-written Pine Script v5 code
// (ea-research/marketplace-research/m15-new-products/source/
// AT24_Smart_Money_Structure.pine), and zeroes the rating/downloads
// fields (already not displayed since the R1.0 fake-data fix, but the
// underlying values were still fabricated - fixing at the source too).
import "dotenv/config";
import { prisma } from "../lib/prisma";

const SLUG = "smart-money-indicator";

const fullDescription = `AT24 Smart Money Structure is a real, newly-written Pine Script v5 indicator implementing Smart Money Concepts (SMC) market structure analysis - the same structural logic (liquidity sweep + market-structure-shift + fair value gap confluence) already used in AT24's own MQL5 research (G01 LiquiditySweep MSS FVG).

What it actually draws on the chart:
- Market structure: swing-based Break of Structure (BOS) and Change of Character (CHoCH) labels
- Order blocks: the last opposing-color candle before a structure break, auto-extended and removed once mitigated (wick or close, your choice)
- Fair Value Gaps: 3-candle imbalance zones, auto-removed once fully filled
- Equal-high / equal-low liquidity pools, marked as dotted connector lines
- Premium / Discount / Equilibrium zone shading based on the current swing range

Honesty note: this is a visual structure/context indicator - it does not place trades and does not claim any backtested win-rate or return, because an indicator has no P&L of its own. The underlying SMC concepts are a well-established institutional order-flow methodology, not an invented gimmick. This script has been written to standard Pine v5 patterns but has NOT been compiled or run inside TradingView by AT24 (no TradingView test environment available here) - verify it in your own TradingView account before relying on it live.`;

async function main() {
  const updated = await prisma.product.updateMany({
    where: { slug: SLUG, deletedAt: null },
    data: {
      shortDescription: "Real Smart Money Concepts (SMC) structure indicator for TradingView - BOS/CHoCH, order blocks, FVGs, liquidity pools.",
      fullDescription,
      features: [
        "BOS / CHoCH market structure labels",
        "Order blocks with auto-mitigation (wick or close)",
        "Fair Value Gap (imbalance) detection, auto-fill removal",
        "Equal-high / equal-low liquidity pool marking",
        "Premium / Discount / Equilibrium zone shading",
        "Alerts on bullish/bearish structure breaks",
      ],
      specifications: [
        { label: "Platform", value: "TradingView (Pine Script v5)" },
        { label: "Type", value: "Indicator (visual structure overlay, not a strategy)" },
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
