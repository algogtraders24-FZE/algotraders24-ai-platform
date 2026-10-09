// services/telegram/store.ts
// The persistence interface for AT24 Telegram (so the logic is tested with an in-memory fake) and its Prisma implementation.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const LINK_CODE_TTL_MS = 15 * 60_000;
export const MAX_CODES_PER_USER = 5;

export interface LinkRow {
  userId: string;
  chatId: string;
  username: string | null;
  alertsOn: boolean;
  watchOn: boolean;
  linkedAt: Date;
}

export interface TelegramStore {
  /** Saves a code hash for a user (older unused codes beyond the cap are dropped). */
  createCode(userId: string, codeHash: string, expiresAt: Date): Promise<void>;
  /** Atomically consumes a code: the user id if it exists, is not expired and was not used; otherwise null. */
  consumeCode(codeHash: string, now: Date): Promise<string | null>;
  /** One chat per user and one user per chat: any previous link of either side is replaced. */
  link(userId: string, chatId: string, username: string | null): Promise<void>;
  getByUser(userId: string): Promise<LinkRow | null>;
  getByChat(chatId: string): Promise<LinkRow | null>;
  unlinkByUser(userId: string): Promise<boolean>;
  unlinkByChat(chatId: string): Promise<boolean>;
  setPrefs(userId: string, prefs: { alertsOn?: boolean; watchOn?: boolean }): Promise<boolean>;
  touchSent(userId: string, at: Date): Promise<void>;
  /** Channel announcement log: has (kind, refId) been posted? */
  hasPosted(kind: string, refId: string): Promise<boolean>;
  recordPost(kind: string, refId: string, messageId: string | null): Promise<void>;
}

export function newLinkCode(): { code: string; hash: string } {
  const code = randomBytes(16).toString("hex");
  return { code, hash: hashCode(code) };
}

export function hashCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

/** "/start <payload>" -> the payload if it looks like one of our codes (32 hex chars), else null. */
export function parseStartPayload(text: string): string | null {
  const m = /^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{1,64}))?\s*$/.exec(text.trim());
  if (!m || !m[1]) return null;
  return /^[0-9a-f]{32}$/.test(m[1]) ? m[1] : null;
}

/** Timing-safe equality for the webhook secret header. */
export function secretMatches(provided: string | null | undefined, expected: string): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------- Prisma implementation
export function prismaTelegramStore(): TelegramStore {
  // Loaded lazily so tests and scripts that only use the pure helpers above never load Prisma.
  const db = async () => (await import("@/lib/prisma")).prisma;
  const toRow = (r: { userId: string; chatId: string; username: string | null; alertsOn: boolean; watchOn: boolean; linkedAt: Date }): LinkRow => ({ userId: r.userId, chatId: r.chatId, username: r.username, alertsOn: r.alertsOn, watchOn: r.watchOn, linkedAt: r.linkedAt });
  return {
    async createCode(userId, codeHash, expiresAt) {
      const prisma = await db();
      await prisma.telegramLinkCode.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date() } }, { userId, id: { notIn: (await prisma.telegramLinkCode.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: MAX_CODES_PER_USER - 1, select: { id: true } })).map((c) => c.id) } }] } });
      await prisma.telegramLinkCode.create({ data: { userId, codeHash, expiresAt } });
    },
    async consumeCode(codeHash, now) {
      const prisma = await db();
      const row = await prisma.telegramLinkCode.findUnique({ where: { codeHash } });
      if (!row || row.expiresAt.getTime() <= now.getTime()) return null;
      const del = await prisma.telegramLinkCode.deleteMany({ where: { id: row.id } });
      return del.count === 1 ? row.userId : null;
    },
    async link(userId, chatId, username) {
      const prisma = await db();
      await prisma.$transaction([
        prisma.telegramLink.deleteMany({ where: { OR: [{ chatId }, { userId }] } }),
        prisma.telegramLink.create({ data: { userId, chatId, username } }),
      ]);
    },
    async getByUser(userId) {
      const prisma = await db();
      const r = await prisma.telegramLink.findUnique({ where: { userId } });
      return r ? toRow(r) : null;
    },
    async getByChat(chatId) {
      const prisma = await db();
      const r = await prisma.telegramLink.findUnique({ where: { chatId } });
      return r ? toRow(r) : null;
    },
    async unlinkByUser(userId) {
      const prisma = await db();
      return (await prisma.telegramLink.deleteMany({ where: { userId } })).count > 0;
    },
    async unlinkByChat(chatId) {
      const prisma = await db();
      return (await prisma.telegramLink.deleteMany({ where: { chatId } })).count > 0;
    },
    async setPrefs(userId, prefs) {
      const prisma = await db();
      const data: { alertsOn?: boolean; watchOn?: boolean } = {};
      if (prefs.alertsOn !== undefined) data.alertsOn = prefs.alertsOn;
      if (prefs.watchOn !== undefined) data.watchOn = prefs.watchOn;
      return (await prisma.telegramLink.updateMany({ where: { userId }, data })).count > 0;
    },
    async touchSent(userId, at) {
      const prisma = await db();
      await prisma.telegramLink.updateMany({ where: { userId }, data: { lastSentAt: at } });
    },
    async hasPosted(kind, refId) {
      const prisma = await db();
      return (await prisma.telegramChannelPost.findUnique({ where: { kind_refId: { kind, refId } }, select: { id: true } })) !== null;
    },
    async recordPost(kind, refId, messageId) {
      const prisma = await db();
      await prisma.telegramChannelPost.upsert({ where: { kind_refId: { kind, refId } }, create: { kind, refId, messageId }, update: {} });
    },
  };
}
