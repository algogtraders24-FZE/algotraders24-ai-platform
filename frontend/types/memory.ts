// types/memory.ts
// Sprint 12F — AI Memory & Context Engine
// Central type definitions for the Memory & Context system.

export type MemoryType =
  | "conversation"
  | "agent"
  | "trading"
  | "knowledge"
  | "strategy"
  | "market"
  | "userPreference"
  | "execution";

export type MemoryStatus =
  | "active"
  | "archived"
  | "expired"
  | "compressed"
  | "pinned";

export type MemoryPriority = "low" | "medium" | "high" | "critical";

export type CompressionStatus =
  | "none"
  | "pending"
  | "compressed"
  | "failed";

export interface MemoryRecord {
  id: string;
  title: string;
  summary: string;
  memoryType: MemoryType;
  source: string;
  agent: string | null;
  conversationId: string | null;
  priority: MemoryPriority;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  status: MemoryStatus;
  retrievalCount: number;
  contextSize: number; // tokens
  compressionStatus: CompressionStatus;
}

export interface MemorySession {
  id: string;
  title: string;
  agent: string | null;
  memoryType: MemoryType;
  memoryIds: string[];
  startedAt: string;
  lastActiveAt: string;
  messageCount: number;
  totalContextSize: number;
  status: MemoryStatus;
}

export interface ContextBundle {
  id: string;
  query: string;
  builtAt: string;
  sourceMemoryIds: string[];
  totalTokens: number;
  memoryTypes: MemoryType[];
  relevanceScore: number; // 0..1
  truncated: boolean;
}

export interface MemoryRetrievalEvent {
  id: string;
  memoryId: string;
  memoryTitle: string;
  query: string;
  retrievedAt: string;
  relevanceScore: number; // 0..1
  agent: string | null;
}

export interface RetentionPolicy {
  memoryType: MemoryType;
  ttlDays: number | null; // null = no expiry
  maxRecords: number | null;
  autoCompressAfterDays: number | null;
  autoArchiveAfterDays: number | null;
  pinnedExempt: boolean;
}

export interface MemoryMetrics {
  totalMemories: number;
  activeSessions: number;
  storedContext: number; // total tokens stored
  contextRetrievedToday: number;
  averageContextSize: number; // tokens
  memoryHealth: number; // 0..100
  retrievalAccuracy: number; // 0..1
  compressionRatio: number; // 0..1 (saved / original)
}

export interface MemoryInsight {
  id: string;
  label: string;
  detail: string;
  trend: "up" | "down" | "flat";
  changePct: number;
  severity: "info" | "success" | "warning" | "critical";
}

export interface MemorySearchQuery {
  text: string;
  memoryTypes?: MemoryType[];
  statuses?: MemoryStatus[];
  tags?: string[];
}

export interface MemorySearchResult {
  record: MemoryRecord;
  score: number; // 0..1
  matchedFields: string[];
}

export interface MemoryTimelineEntry {
  id: string;
  memoryId: string;
  title: string;
  memoryType: MemoryType;
  event: "created" | "updated" | "retrieved" | "compressed" | "archived" | "pinned";
  timestamp: string;
}
