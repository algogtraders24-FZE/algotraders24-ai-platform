import type { ProductCategoryId } from "@/types/product";

export interface Category {
  id: ProductCategoryId;
  name: string;
  shortName: string;
  description: string;
}

export const CATEGORIES: Category[] = [
  {
    id: "mt5-expert-advisors",
    name: "MT5 Expert Advisors",
    shortName: "MT5 EAs",
    description: "Automated trading robots for MetaTrader 5.",
  },
  {
    id: "mt4-expert-advisors",
    name: "MT4 Expert Advisors",
    shortName: "MT4 EAs",
    description: "Automated trading robots for MetaTrader 4.",
  },
  {
    id: "tradingview-indicators",
    name: "TradingView Indicators",
    shortName: "TV Indicators",
    description: "Custom indicators for TradingView charts.",
  },
  {
    id: "tradingview-strategies",
    name: "TradingView Strategies",
    shortName: "TV Strategies",
    description: "Backtestable strategies for TradingView.",
  },
  {
    id: "ctrader-cbots",
    name: "cTrader cBots",
    shortName: "cBots",
    description: "Automated cBots for the cTrader platform.",
  },
  {
    id: "ninjatrader-bots",
    name: "NinjaTrader Bots",
    shortName: "NT Bots",
    description: "Automated strategies for NinjaTrader.",
  },
  {
    id: "crypto-bots",
    name: "Crypto Trading Bots",
    shortName: "Crypto Bots",
    description: "Trading bots for crypto exchanges.",
  },
  {
    id: "indian-market-algos",
    name: "Indian Market Algorithms",
    shortName: "India Algos",
    description: "Algo strategies for NSE, BSE & MCX.",
  },
];