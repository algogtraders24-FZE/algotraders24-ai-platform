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

/** Status badge colors reused across knowledge components.
 * Sprint D1.1 - token-based (success/info/warning/danger/neutral), matching
 * the Badge primitive's tones, replacing raw emerald/indigo/amber/red/slate. */
export const DOC_STATUS_STYLES: Record<DocumentStatus, string> = {
  indexed: "bg-success/10 text-success border-success/30",
  processing: "bg-info/10 text-info border-info/30",
  pending: "bg-warning/10 text-warning border-warning/30",
  failed: "bg-danger/10 text-danger border-danger/30",
  archived: "bg-ink-3 text-text-2 border-border",
};