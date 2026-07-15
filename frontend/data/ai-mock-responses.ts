// data/ai-mock-responses.ts
// AI provider fallback responses (keyword -> reply). Used by the mock AI
// provider until the live provider (Gemini) is wired. Not user data.
export const mockResponses: { keywords: string[]; response: string }[] = [
  { keywords: ["gold", "xauusd"], response: "XAUUSD read: neutral-to-bullish above 2670. Break and retest of 2692 targets 2710; below 2670 opens 2655. Wait for confirmation." },
  { keywords: ["eurusd", "euro"], response: "EURUSD read: bullish while above 1.0810. Momentum favors 1.0880 then 1.0910. Invalidate below 1.0810." },
  { keywords: ["smart money", "smc"], response: "Smart Money Concepts: institutions engineer liquidity above highs and below lows, then reverse from order blocks and fair value gaps. Trade with structure, not against it." },
  { keywords: ["ict"], response: "ICT concepts focus on liquidity, order blocks, fair value gaps, and killzones (session timing). Entries target displacement after a liquidity sweep." },
  { keywords: ["order block"], response: "An order block is the last opposing candle before an impulsive move. Traders mark it as a zone and look for price to return and react from it." },
  { keywords: ["scalp"], response: "Gold scalping: trade London/NY sessions, enter on order-block retest after a liquidity grab, keep a tight 10-pip stop at 1:1.5 RR." },
  { keywords: ["risk"], response: "Risk management: risk a fixed 1% per trade, cap daily loss at 3%, size positions off stop distance, and never move a stop against the trade." },
  { keywords: ["mt5", "expert advisor", "ea"], response: "MT5 EA logic (concept): OnTick() checks the setup condition, validates risk, opens a trade via OrderSend, then manages SL/TP. Keep strategy rules in one module, execution in another." },
  { keywords: ["liquidity"], response: "Liquidity sits where stops cluster - above equal highs and below equal lows. Price often sweeps these zones before reversing." },
  { keywords: ["portfolio", "diversif"], response: "Diversify across uncorrelated markets (forex, commodities, indices), cap exposure per market, and rebalance so no single position dominates risk." },
];

export const DEFAULT_RESPONSE =
  "I'm the Algotraders24 AI Strategy Assistant. Ask me to analyze a market, explain a concept, or build a strategy.";
