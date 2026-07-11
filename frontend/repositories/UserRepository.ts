// repositories/UserRepository.ts
// Sprint 14A — Backend Foundation (contract)
// Sprint 14C — Migrated to Prisma. Mock SEED removed. Real DB queries.
import type { BaseEntity } from "@/types/backend";
import { BaseRepository } from "./BaseRepository";
import { prisma } from "@/lib/prisma";
import type { User as PrismaUser } from "@/lib/generated/prisma/client";

export interface UserEntity extends BaseEntity {
  authId: string | null;
  email: string;
  name: string;
  role: "user" | "admin";
  planId: string;
  status: "active" | "suspended";
  emailVerified: boolean;
}

function toEntity(row: PrismaUser): UserEntity {
  return {
    id: row.id,
    authId: row.authId,
    email: row.email,
    name: row.name,
    role: row.role === "admin" ? "admin" : "user",
    planId: row.planId,
    status: row.status === "suspended" ? "suspended" : "active",
    emailVerified: row.emailVerified,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class UserRepository extends BaseRepository<UserEntity> {
  protected entityName = "user";

  constructor() {
    super([]);
  }

  async findAll(): Promise<UserEntity[]> {
    const rows = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map(toEntity);
  }

  async findById(id: string): Promise<UserEntity | null> {
    const row = await prisma.user.findUnique({ where: { id } });
    return row ? toEntity(row) : null;
  }

  async findByEmail(email: string): Promise<UserEntity | null> {
    const row = await prisma.user.findUnique({ where: { email } });
    return row ? toEntity(row) : null;
  }

  async findByAuthId(authId: string): Promise<UserEntity | null> {
    const row = await prisma.user.findUnique({ where: { authId } });
    return row ? toEntity(row) : null;
  }

  async create(
    input: Omit<UserEntity, "id" | "createdAt" | "updatedAt">
  ): Promise<UserEntity> {
    const row = await prisma.user.create({
      data: {
        authId: input.authId,
        email: input.email,
        name: input.name,
        role: input.role,
        planId: input.planId,
        status: input.status,
        emailVerified: input.emailVerified,
      },
    });
    return toEntity(row);
  }

  async update(
    id: string,
    patch: Partial<Omit<UserEntity, "id" | "createdAt">>
  ): Promise<UserEntity | null> {
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) return null;
    const row = await prisma.user.update({
      where: { id },
      data: {
        authId: patch.authId ?? undefined,
        email: patch.email ?? undefined,
        name: patch.name ?? undefined,
        role: patch.role ?? undefined,
        planId: patch.planId ?? undefined,
        status: patch.status ?? undefined,
        emailVerified: patch.emailVerified ?? undefined,
      },
    });
    return toEntity(row);
  }

  async delete(id: string): Promise<boolean> {
    try {
      await prisma.user.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  async count(): Promise<number> {
    return prisma.user.count();
  }

  async findOrCreateByAuth(params: {
    authId: string;
    email: string;
    name: string;
    emailVerified: boolean;
  }): Promise<UserEntity> {
    const existing = await prisma.user.findUnique({
      where: { authId: params.authId },
    });
    if (existing) {
      if (existing.emailVerified !== params.emailVerified) {
        const updated = await prisma.user.update({
          where: { authId: params.authId },
          data: { emailVerified: params.emailVerified },
        });
        return toEntity(updated);
      }
      return toEntity(existing);
    }

    const byEmail = await prisma.user.findUnique({
      where: { email: params.email },
    });
    if (byEmail) {
      const linked = await prisma.user.update({
        where: { email: params.email },
        data: { authId: params.authId, emailVerified: params.emailVerified },
      });
      return toEntity(linked);
    }

    const created = await prisma.user.create({
      data: {
        authId: params.authId,
        email: params.email,
        name: params.name || params.email.split("@")[0],
        role: "user",
        planId: "free",
        status: "active",
        emailVerified: params.emailVerified,
      },
    });
    return toEntity(created);
  }
}
