// services/agent-framework/memory/memory-store.ts
// AT24 Agent Framework - A7. The persistence PORT the MemoryGateway depends
// on. Two implementations: PrismaMemoryStore (the real AgentMemoryRecord
// table, once its migration is applied) and InMemoryStore (tests + a stand-in
// until then). The gateway never touches Prisma directly.

import type {
  MemoryLayer,
  MemoryProvenance,
  MemoryRecordStatus,
  MemoryRetention,
} from "@/types/agent-framework";

export interface StoredMemoryRecord {
  id: string;
  agentId: string;
  agentType: string;
  userId: string;
  runId: string | null;
  layer: Exclude<MemoryLayer, "RUN_STATE">;
  scope: string;
  key: string;
  value: unknown;
  retention: MemoryRetention;
  provenance: MemoryProvenance;
  status: MemoryRecordStatus;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type NewMemoryRecord = Omit<StoredMemoryRecord, "id" | "createdAt" | "updatedAt">;

export interface MemoryQuery {
  userId: string;
  layer: Exclude<MemoryLayer, "RUN_STATE">;
  /** "own" -> also filter agentId; "agent-type" -> also filter agentType. */
  agentId?: string;
  agentType?: string;
  scope?: string;
  key?: string;
  status?: MemoryRecordStatus;
  /** exclude records whose expiresAt is <= this ISO time. */
  notExpiredAsOf?: string;
  limit?: number;
}

export interface MemoryStore {
  insert(rec: NewMemoryRecord): Promise<StoredMemoryRecord>;
  query(q: MemoryQuery): Promise<StoredMemoryRecord[]>;
  getById(id: string): Promise<StoredMemoryRecord | null>;
  markStatus(id: string, status: MemoryRecordStatus): Promise<void>;
  /** test-only: remove everything for a synthetic user. */
  clearForUser(userId: string): Promise<number>;
}
