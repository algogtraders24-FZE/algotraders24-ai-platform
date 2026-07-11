// types/backend.ts
// Sprint 14A — Backend Foundation
// Backend domain types: health, version, system status, logging, repositories.

export type ServiceHealth = "operational" | "degraded" | "down" | "unknown";

export type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

export type Environment = "development" | "staging" | "production";

export interface HealthReport {
  status: ServiceHealth;
  version: string;
  environment: Environment;
  timestamp: string;
  uptime: number; // seconds
}

export interface VersionInfo {
  platformVersion: string;
  buildVersion: string;
  release: string;
  sprint: string;
}

export interface SubsystemStatus {
  name: string;
  health: ServiceHealth;
  detail: string;
}

export interface SystemStatusReport {
  database: SubsystemStatus;
  aiProviders: SubsystemStatus;
  automation: SubsystemStatus;
  knowledge: SubsystemStatus;
  agents: SubsystemStatus;
  billing: SubsystemStatus;
  publishing: SubsystemStatus;
  overallHealth: ServiceHealth;
  timestamp: string;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
}

// Base shape every persisted entity shares.
export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
}

// Generic repository contract implemented by every repository.
export interface IRepository<T extends BaseEntity> {
  findAll(): Promise<T[]>;
  findById(id: string): Promise<T | null>;
  create(input: Omit<T, "id" | "createdAt" | "updatedAt">): Promise<T>;
  update(id: string, patch: Partial<Omit<T, "id" | "createdAt">>): Promise<T | null>;
  delete(id: string): Promise<boolean>;
  count?(): Promise<number>;
}
