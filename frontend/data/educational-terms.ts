// data/educational-terms.ts
// Sprint D2.3.S4 - a small glossary of technical trading-concept terms, for
// optional inline InfoTooltip definitions wherever a term genuinely appears
// in the UI. Deliberately NOT wired into free-text AI output (regex-parsing
// AI markdown to auto-wrap terms is fragile and risks changing how AI output
// renders) - only into structured UI labels/buttons that already show one of
// these words. Definitions are plain, neutral, and educational - never
// trading advice.
export interface EducationalTerm {
  term: string;
  definition: string;
}

export const EDUCATIONAL_TERMS: Record<string, EducationalTerm> = {
  bos: {
    term: "Break of Structure (BOS)",
    definition: "A price move beyond a prior significant high or low, often used to identify a continuation of the existing trend.",
  },
  choch: {
    term: "Change of Character (CHOCH)",
    definition: "A shift in price behavior that breaks the pattern of the prior trend, often studied as an early signal that a trend may be changing.",
  },
  "order block": {
    term: "Order Block",
    definition: "A price zone where a large concentration of orders is believed to have occurred, often studied as an area where price may react on a later return.",
  },
  liquidity: {
    term: "Liquidity",
    definition: "How easily an asset can be bought or sold near its current price without materially moving that price. Not computed by every engine in this platform - shown as \"Not available\" where no real signal exists.",
  },
  "fair value gap": {
    term: "Fair Value Gap (FVG)",
    definition: "A price range left behind by a fast, one-directional move, often studied as an imbalance area that price may later revisit.",
  },
};

export const LIQUIDITY_DEFINITION = EDUCATIONAL_TERMS.liquidity;
export const ORDER_BLOCK_DEFINITION = EDUCATIONAL_TERMS["order block"];
