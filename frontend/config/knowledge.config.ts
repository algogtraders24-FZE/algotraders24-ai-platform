// config/knowledge.config.ts
// AI Knowledge Base — configuration

import type { DocumentStatus } from "@/types/knowledge";

export const KNOWLEDGE_CONFIG = {
  version: "1.0.0-foundation",
  defaultProvider: "gemini",
  maxContextDocuments: 5,
  maxContextChars: 6000,
  reindexIntervalHours: 24,
} as const;

export const KNOWLEDGE_CATEGORIES = [
  "Trading Strategies", "MT5", "MQL5", "TradingView", "Python", "AI Models",
  "Risk Management", "Smart Money Concepts", "ICT", "Wyckoff", "Elliott Wave",
  "Market Structure", "Forex", "Gold", "Crypto", "Stocks", "Indices",
  "Support", "Documentation", "SEO Articles",
] as const;

export const KNOWLEDGE_COLLECTIONS = [
  "Trading Knowledge", "Platform Documentation", "AI Research",
  "Market Analysis", "Customer Support", "Product Manuals", "Developer Docs",
] as const;

/** Status badge colors reused across knowledge components. */
export const DOC_STATUS_STYLES: Record<DocumentStatus, string> = {
  indexed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  processing: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  pending: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
  archived: "bg-slate-500/15 text-slate-400 border-slate-500/30",
};