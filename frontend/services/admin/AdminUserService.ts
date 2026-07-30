// services/admin/AdminUserService.ts
// Sprint L2.6 - Phase 2: User Management. Reuses the existing, already-real
// UserRepository (Prisma-backed) rather than introducing a second query
// path. Every mutation is scoped to fields that already exist on User
// (role, status) - never a hard delete (UserRepository.delete() performs
// a real DB DELETE with no cascade to a user's Conversations/Knowledge/etc,
// since those relations are plain userId strings, not FKs - calling it from
// an admin action would silently orphan a large amount of that user's real
// data). Suspension (status: "suspended") is the only real removal action
// offered; every mutation is audit-logged by the caller (the API route).
import { prisma } from "@/lib/prisma";
import { UserRepository, type UserEntity } from "@/repositories/UserRepository";

const userRepo = new UserRepository();

export interface AdminUserSummary {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  planId: string;
  status: "active" | "suspended";
  emailVerified: boolean;
  createdAt: string;
}

export interface AdminUserDetail extends AdminUserSummary {
  conversationCount: number;
  knowledgeDocumentCount: number;
  agentCount: number;
}

export interface AdminUserPage {
  items: AdminUserSummary[];
  total: number;
}

function toSummary(u: UserEntity): AdminUserSummary {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    planId: u.planId,
    status: u.status,
    emailVerified: u.emailVerified,
    createdAt: u.createdAt,
  };
}

export class AdminUserService {
  async listUsers(params: { page: number; pageSize: number; query?: string }): Promise<AdminUserPage> {
    const page = Math.max(1, params.page);
    const pageSize = Math.min(100, Math.max(1, params.pageSize));
    const query = params.query?.trim();

    const where = query
      ? {
          deletedAt: null,
          OR: [
            { email: { contains: query, mode: "insensitive" as const } },
            { name: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : { deletedAt: null };

    const [rows, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.user.count({ where }),
    ]);

    return {
      items: rows.map((r) =>
        toSummary({
          id: r.id,
          authId: r.authId,
          email: r.email,
          name: r.name,
          role: r.role === "admin" ? "admin" : "user",
          planId: r.planId,
          status: r.status === "suspended" ? "suspended" : "active",
          emailVerified: r.emailVerified,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        }),
      ),
      total,
    };
  }

  async getUser(userId: string): Promise<AdminUserDetail | null> {
    const user = await userRepo.findById(userId);
    if (!user) return null;

    const [conversationCount, knowledgeDocumentCount, agentCount] = await Promise.all([
      prisma.conversation.count({ where: { userId, deletedAt: null } }),
      prisma.knowledge.count({ where: { userId, deletedAt: null } }),
      prisma.agent.count({ where: { userId, deletedAt: null } }),
    ]);

    return { ...toSummary(user), conversationCount, knowledgeDocumentCount, agentCount };
  }

  async setRole(userId: string, role: "user" | "admin"): Promise<UserEntity | null> {
    return userRepo.update(userId, { role });
  }

  async setStatus(userId: string, status: "active" | "suspended"): Promise<UserEntity | null> {
    return userRepo.update(userId, { status });
  }
}

export const adminUserService = new AdminUserService();
