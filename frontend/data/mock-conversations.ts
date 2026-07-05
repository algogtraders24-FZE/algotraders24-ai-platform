// data/mock-conversations.ts
import type { Conversation } from "@/types/conversation";

export const mockConversations: Conversation[] = [
  {
    id: "conv-1",
    title: "Analyze Gold",
    createdAt: "2025-01-15T09:00:00Z",
    updatedAt: "2025-01-15T09:05:00Z",
    messages: [
      { id: "m1", role: "user", content: "Analyze XAUUSD on the 1H.", createdAt: "2025-01-15T09:00:00Z" },
      {
        id: "m2",
        role: "assistant",
        content:
          "XAUUSD (1H): price is consolidating below 2692 resistance. Bias is neutral-to-bullish while above 2670. A break and retest of 2692 opens 2710; losing 2670 shifts bias bearish toward 2655. Wait for confirmation before entry.",
        createdAt: "2025-01-15T09:00:05Z",
      },
    ],
  },
  {
    id: "conv-2",
    title: "Smart Money Concepts",
    createdAt: "2025-01-14T14:00:00Z",
    updatedAt: "2025-01-14T14:03:00Z",
    messages: [
      { id: "m3", role: "user", content: "Explain Smart Money Concepts.", createdAt: "2025-01-14T14:00:00Z" },
      {
        id: "m4",
        role: "assistant",
        content:
          "Smart Money Concepts (SMC) track how institutions move price: liquidity grabs above/below obvious highs and lows, order blocks (last candle before an impulsive move), fair value gaps, and break of structure. The idea is to trade with institutional flow rather than against it.",
        createdAt: "2025-01-14T14:00:04Z",
      },
    ],
  },
];

/** Mock provider keyword → response map. */
export const mockResponses: { keywords: string[]; response: string }[] = [
  {
    keywords: ["gold", "xauusd"],
    response:
      "XAUUSD read: neutral-to-bullish above 2670. Break and retest of 2692 targets 2710; below 2670 opens 2655. Wait for confirmation.",
  },
  {
    keywords: ["eurusd", "euro"],
    response:
      "EURUSD read: bullish while above 1.0810. Momentum favors 1.0880 then 1.0910. Invalidate below 1.0810.",
  },
  {
    keywords: ["smart money", "smc"],
    response:
      "Smart Money Concepts: institutions engineer liquidity above highs and below lows, then reverse from order blocks and fair value gaps. Trade with structure, not against it.",
  },
  {
    keywords: ["ict"],
    response:
      "ICT concepts focus on liquidity, order blocks, fair value gaps, and killzones (session timing). Entries target displacement after a liquidity sweep.",
  },
  {
    keywords: ["order block"],
    response:
      "An order block is the last opposing candle before an impulsive move. Traders mark it as a zone and look for price to return and react from it.",
  },
  {
    keywords: ["scalp"],
    response:
      "Gold scalping: trade London/NY sessions, enter on order-block retest after a liquidity grab, keep a tight 10-pip stop at 1:1.5 RR.",
  },
  {
    keywords: ["risk"],
    response:
      "Risk management: risk a fixed 1% per trade, cap daily loss at 3%, size positions off stop distance, and never move a stop against the trade.",
  },
  {
    keywords: ["mt5", "expert advisor", "ea"],
    response:
      "MT5 EA logic (concept): OnTick() checks the setup condition, validates risk, opens a trade via OrderSend, then manages SL/TP. Keep strategy rules in one module, execution in another.",
  },
  {
    keywords: ["liquidity"],
    response:
      "Liquidity sits where stops cluster — above equal highs and below equal lows. Price often sweeps these zones before reversing.",
  },
  {
    keywords: ["portfolio", "diversif"],
    response:
      "Diversify across uncorrelated markets (forex, commodities, indices), cap exposure per market, and rebalance so no single position dominates risk.",
  },
];

export const DEFAULT_RESPONSE =
  "I'm the Algotraders24 AI Strategy Assistant (mock). Ask me to analyze a market, explain a concept, or build a strategy.";