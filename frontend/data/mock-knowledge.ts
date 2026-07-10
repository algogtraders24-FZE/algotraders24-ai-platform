// data/mock-knowledge.ts
import type { KnowledgeDocument, KnowledgeCollection, RetrievalRecord } from "@/types/knowledge";

export const mockDocuments: KnowledgeDocument[] = [
  { id: "doc-001", title: "Smart Money Concepts Explained", description: "Institutional order flow, liquidity, and order blocks.", category: "Smart Money Concepts", collection: "Trading Knowledge", author: "Algotraders24 Research", tags: ["smc", "liquidity", "order blocks"], provider: "gemini", language: "en", fileType: "md", documentSize: 18400, createdAt: "2025-01-10T06:00:00Z", updatedAt: "2025-01-14T06:00:00Z", lastIndexed: "2025-01-14T07:00:00Z", status: "indexed", embeddingStatus: "embedded", retrievalCount: 214, popularity: 95 },
  { id: "doc-002", title: "MQL5 Expert Advisor Basics", description: "Structure of an MT5 EA: OnTick, OrderSend, risk handling.", category: "MQL5", collection: "Developer Docs", author: "Dev Team", tags: ["mql5", "mt5", "ea"], provider: "gemini", language: "en", fileType: "code", documentSize: 24500, createdAt: "2025-01-08T06:00:00Z", updatedAt: "2025-01-12T06:00:00Z", lastIndexed: "2025-01-12T07:00:00Z", status: "indexed", embeddingStatus: "embedded", retrievalCount: 168, popularity: 88 },
  { id: "doc-003", title: "Risk Management Framework", description: "Position sizing, drawdown limits, and exposure rules.", category: "Risk Management", collection: "Trading Knowledge", author: "Algotraders24 Research", tags: ["risk", "position sizing", "drawdown"], provider: "gemini", language: "en", fileType: "md", documentSize: 15200, createdAt: "2025-01-09T06:00:00Z", updatedAt: "2025-01-13T06:00:00Z", lastIndexed: "2025-01-13T07:00:00Z", status: "indexed", embeddingStatus: "embedded", retrievalCount: 190, popularity: 91 },
  { id: "doc-004", title: "Gold Trading Playbook", description: "Session timing, key levels, and XAUUSD strategies.", category: "Gold", collection: "Market Analysis", author: "Analyst Desk", tags: ["gold", "xauusd", "strategy"], provider: "gemini", language: "en", fileType: "md", documentSize: 20100, createdAt: "2025-01-11T06:00:00Z", updatedAt: "2025-01-15T06:00:00Z", lastIndexed: null, status: "processing", embeddingStatus: "processing", retrievalCount: 42, popularity: 64 },
  { id: "doc-005", title: "Platform Getting Started Guide", description: "How to use the Algotraders24 dashboard and features.", category: "Documentation", collection: "Platform Documentation", author: "Product Team", tags: ["guide", "onboarding", "platform"], provider: "gemini", language: "en", fileType: "html", documentSize: 12800, createdAt: "2025-01-05T06:00:00Z", updatedAt: "2025-01-10T06:00:00Z", lastIndexed: "2025-01-10T07:00:00Z", status: "indexed", embeddingStatus: "embedded", retrievalCount: 320, popularity: 97 },
  { id: "doc-006", title: "ICT Killzones & Liquidity", description: "Session killzones, fair value gaps, and displacement.", category: "ICT", collection: "Trading Knowledge", author: "Algotraders24 Research", tags: ["ict", "killzones", "fvg"], provider: "gemini", language: "en", fileType: "md", documentSize: 17600, createdAt: "2025-01-07T06:00:00Z", updatedAt: "2025-01-11T06:00:00Z", lastIndexed: null, status: "pending", embeddingStatus: "pending", retrievalCount: 12, popularity: 55 }
];

export const mockCollections: KnowledgeCollection[] = [
  { id: "col-1", name: "Trading Knowledge", description: "Strategies, concepts, and playbooks.", documentCount: 3 },
  { id: "col-2", name: "Platform Documentation", description: "Guides and how-tos.", documentCount: 1 },
  { id: "col-3", name: "AI Research", description: "Model and prompt research.", documentCount: 0 },
  { id: "col-4", name: "Market Analysis", description: "Daily and weekly analysis.", documentCount: 1 },
  { id: "col-5", name: "Customer Support", description: "FAQs and troubleshooting.", documentCount: 0 },
  { id: "col-6", name: "Product Manuals", description: "Product usage manuals.", documentCount: 0 },
  { id: "col-7", name: "Developer Docs", description: "MQL5, Python, and API docs.", documentCount: 1 }
];

export const mockRetrievals: RetrievalRecord[] = [
  { id: "ret-1", query: "what is an order block", documentId: "doc-001", documentTitle: "Smart Money Concepts Explained", retrievedAt: "2025-01-15T09:10:00Z", score: 94 },
  { id: "ret-2", query: "how to size a position", documentId: "doc-003", documentTitle: "Risk Management Framework", retrievedAt: "2025-01-15T09:20:00Z", score: 90 },
  { id: "ret-3", query: "gold session timing", documentId: "doc-004", documentTitle: "Gold Trading Playbook", retrievedAt: "2025-01-15T09:30:00Z", score: 82 },
  { id: "ret-4", query: "mt5 ea structure", documentId: "doc-002", documentTitle: "MQL5 Expert Advisor Basics", retrievedAt: "2025-01-15T09:40:00Z", score: 88 }
];
