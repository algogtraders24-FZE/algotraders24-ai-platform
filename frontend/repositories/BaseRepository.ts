// repositories/BaseRepository.ts
// Sprint 14A — Backend Foundation
// Abstract in-memory repository implementing the IRepository contract.
// Future: swap the internal Map for Prisma calls without changing callers.

import type { BaseEntity, IRepository } from "@/types/backend";

let __seq = 0;

export abstract class BaseRepository<T extends BaseEntity>
  implements IRepository<T>
{
  protected store: Map<string, T> = new Map();
  protected abstract entityName: string;

  constructor(seed: T[] = []) {
    for (const item of seed) {
      this.store.set(item.id, item);
    }
  }

  protected generateId(): string {
    __seq += 1;
    return (
      this.entityPrefix() +
      "_" +
      Date.now().toString(36) +
      "_" +
      __seq.toString(36)
    );
  }

  protected entityPrefix(): string {
    return this.entityName.slice(0, 3).toLowerCase();
  }

  protected now(): string {
    return new Date().toISOString();
  }

  async findAll(): Promise<T[]> {
    return Array.from(this.store.values());
  }

  async findById(id: string): Promise<T | null> {
    return this.store.get(id) ?? null;
  }

  async create(
    input: Omit<T, "id" | "createdAt" | "updatedAt">
  ): Promise<T> {
    const ts = this.now();
    const entity = {
      ...input,
      id: this.generateId(),
      createdAt: ts,
      updatedAt: ts,
    } as T;
    this.store.set(entity.id, entity);
    return entity;
  }

  async update(
    id: string,
    patch: Partial<Omit<T, "id" | "createdAt">>
  ): Promise<T | null> {
    const existing = this.store.get(id);
    if (!existing) return null;
    const updated = {
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: this.now(),
    } as T;
    this.store.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  async count(): Promise<number> {
    return this.store.size;
  }
}
