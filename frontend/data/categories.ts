// Sprint D2.4.A5 - added `icon`, reusing the exact same lucide icons
// sections/Platforms/index.tsx already uses for each trading ecosystem, so
// a category reads the same way whether it shows up in the marketing
// "Supported Platforms" strip or on a product card - one icon language,
// not two.
import type { LucideIcon } from "lucide-react";
import { Bot, LineChart, Workflow, Activity, Coins, Landmark } from "lucide-react";
import type { ProductCategoryId } from "@/types/product";

export interface Category {
  id: ProductCategoryId;
  name: string;
  shortName: string;
  description: string;
  icon: LucideIcon;
}

export const CATEGORIES: Category[] = [
  { id: "mt5-expert-advisors", name: "MT5 Expert Advisors", shortName: "MT5 EAs", description: "Automated trading robots for MetaTrader 5.", icon: Bot },
  { id: "mt4-expert-advisors", name: "MT4 Expert Advisors", shortName: "MT4 EAs", description: "Automated trading robots for MetaTrader 4.", icon: Bot },
  { id: "tradingview-indicators", name: "TradingView Indicators", shortName: "TV Indicators", description: "Custom indicators for TradingView charts.", icon: LineChart },
  { id: "tradingview-strategies", name: "TradingView Strategies", shortName: "TV Strategies", description: "Backtestable strategies for TradingView.", icon: LineChart },
  { id: "ctrader-cbots", name: "cTrader cBots", shortName: "cBots", description: "Automated cBots for the cTrader platform.", icon: Workflow },
  { id: "ninjatrader-bots", name: "NinjaTrader Bots", shortName: "NT Bots", description: "Automated strategies for NinjaTrader.", icon: Activity },
  { id: "crypto-bots", name: "Crypto Trading Bots", shortName: "Crypto Bots", description: "Trading bots for crypto exchanges.", icon: Coins },
  { id: "indian-market-algos", name: "Indian Market Algorithms", shortName: "India Algos", description: "Algo strategies for NSE, BSE & MCX.", icon: Landmark },
];