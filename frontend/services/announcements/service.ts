// services/announcements/service.ts
// Sends a product announcement from the admin dashboard. Rules that make it safe to use:
//  - never automatic: an admin writes it, sends a test to themselves, then presses Send;
//  - audience = active, verified, not deleted, not opted out, not an internal test address;
//  - one delivery row per (announcement, user) claimed BEFORE sending, so a double click or a retry can never email anyone twice;
//  - every email carries a signed unsubscribe link plus the one-click List-Unsubscribe headers; opted-out users are skipped forever;
//  - sent from support@, replies reach the support inbox.
import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import { getSiteUrl } from "@/lib/payments/env";
import { violatesPolicy } from "@/services/social/content";
import { isAllowedCtaUrl, renderAnnouncementEmail, SUPPORT_ADDRESS, type AnnouncementContent } from "./render";

const FROM = `Algotraders24 AI <${SUPPORT_ADDRESS}>`;
const BATCH_DEFAULT = 60;
const STALE_CLAIM_MS = 10 * 60 * 1000;

function secret(): string {
  const s = process.env.UNSUBSCRIBE_SECRET || process.env.CRON_SECRET;
  if (!s) throw new Error("No UNSUBSCRIBE_SECRET / CRON_SECRET configured - cannot sign unsubscribe links");
  return s;
}

export function unsubscribeToken(userId: string): string {
  return createHmac("sha256", secret()).update(`unsub:${userId}`).digest("base64url");
}

export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  try {
    const a = Buffer.from(unsubscribeToken(userId));
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const pageUrl = (userId: string) => `${getSiteUrl()}/unsubscribe?u=${encodeURIComponent(userId)}&t=${unsubscribeToken(userId)}`;
const apiUrl = (userId: string) => `${getSiteUrl()}/api/unsubscribe?u=${encodeURIComponent(userId)}&t=${unsubscribeToken(userId)}`;

/** Validation shared by create/edit/send. Returns an error message or null. */
export function validateAnnouncement(c: AnnouncementContent): string | null {
  const subject = c.subject?.trim() ?? "";
  if (subject.length < 8 || subject.length > 120) return "Subject must be 8-120 characters";
  if (!c.bodyText || c.bodyText.trim().length < 40 || c.bodyText.length > 4000) return "Body must be 40-4000 characters";
  if ((c.ctaLabel && !c.ctaUrl) || (!c.ctaLabel && c.ctaUrl)) return "Button label and link go together";
  if (c.ctaLabel && c.ctaLabel.length > 40) return "Button label is too long (max 40)";
  if (c.ctaUrl && !isAllowedCtaUrl(c.ctaUrl)) return "Button link must be an https://algotraders24.ai link";
  const bad = violatesPolicy(`${subject}\n${c.bodyText}`);
  if (bad) return `Text ${bad}`;
  return null;
}

export async function audience(): Promise<{ id: string; email: string }[]> {
  const [users, optOuts] = await Promise.all([
    prisma.user.findMany({ where: { deletedAt: null, status: "active", emailVerified: true }, select: { id: true, email: true }, orderBy: { createdAt: "asc" } }),
    prisma.emailOptOut.findMany({ select: { userId: true } }),
  ]);
  const out = new Set(optOuts.map((o) => o.userId));
  return users.filter((u) => !out.has(u.id) && !/@internal\.test$/i.test(u.email));
}

export async function optOutCount(): Promise<number> {
  return prisma.emailOptOut.count();
}

function client(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not configured");
  return new Resend(key);
}

async function deliver(resend: Resend, c: AnnouncementContent, to: string, userId: string) {
  const { html, text } = renderAnnouncementEmail(c, pageUrl(userId));
  return resend.emails.send({
    from: FROM,
    to,
    replyTo: SUPPORT_ADDRESS,
    subject: c.subject.trim(),
    html,
    text,
    headers: { "List-Unsubscribe": `<${apiUrl(userId)}>, <mailto:${SUPPORT_ADDRESS}?subject=unsubscribe>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  });
}

/** One-off lifecycle email (e.g. trial welcome / reminders): same sender, unsubscribe link and headers as an announcement. Returns an error text or null. */
export async function sendLifecycleEmail(userId: string, to: string, c: AnnouncementContent): Promise<string | null> {
  const r = await deliver(client(), c, to, userId);
  return r.error ? r.error.message : null;
}

/** Sends the announcement to ONE address (the admin's own) so the real email can be checked before the real send. */
export async function sendTest(announcementId: string, to: string, forUserId: string): Promise<void> {
  const a = await prisma.productAnnouncement.findUnique({ where: { id: announcementId } });
  if (!a) throw new Error("Announcement not found");
  const err = validateAnnouncement(a);
  if (err) throw new Error(err);
  const r = await deliver(client(), a, to, forUserId);
  if (r.error) throw new Error(r.error.message);
}

export interface BatchResult {
  sent: number;
  failed: number;
  remaining: number;
  done: boolean;
}

/** Sends up to `limit` more recipients. Safe to call again until `done` (resumes; never repeats a recipient). */
export async function sendBatch(announcementId: string, limit = BATCH_DEFAULT): Promise<BatchResult> {
  const a = await prisma.productAnnouncement.findUnique({ where: { id: announcementId } });
  if (!a) throw new Error("Announcement not found");
  if (a.status === "SENT") return { sent: 0, failed: 0, remaining: 0, done: true };
  const err = validateAnnouncement(a);
  if (err) throw new Error(err);
  const resend = client();

  const everyone = await audience();
  if (a.status === "DRAFT") await prisma.productAnnouncement.update({ where: { id: a.id }, data: { status: "SENDING", recipientCount: everyone.length } });

  const existing = await prisma.announcementDelivery.findMany({ where: { announcementId: a.id }, select: { userId: true, status: true, createdAt: true } });
  const byUser = new Map(existing.map((d) => [d.userId, d]));
  const todo = everyone.filter((u) => {
    const d = byUser.get(u.id);
    if (!d) return true;
    if (d.status === "SENT") return false;
    if (d.status === "PENDING") return Date.now() - d.createdAt.getTime() > STALE_CLAIM_MS;
    return true; // FAILED -> retry
  });

  let sent = 0;
  let failed = 0;
  for (const u of todo.slice(0, limit)) {
    // Claim the delivery row first. Another request that claimed it already makes this a no-op.
    const prev = byUser.get(u.id);
    if (!prev) {
      try {
        await prisma.announcementDelivery.create({ data: { announcementId: a.id, userId: u.id, status: "PENDING" } });
      } catch {
        continue; // someone else claimed it between our read and now
      }
    } else {
      const claimed = await prisma.announcementDelivery.updateMany({ where: { announcementId: a.id, userId: u.id, status: prev.status }, data: { status: "PENDING", error: null, createdAt: new Date() } });
      if (claimed.count === 0) continue;
    }
    try {
      const r = await deliver(resend, a, u.email, u.id);
      if (r.error) throw new Error(r.error.message);
      await prisma.announcementDelivery.update({ where: { announcementId_userId: { announcementId: a.id, userId: u.id } }, data: { status: "SENT", providerMessageId: r.data?.id ?? null } });
      sent++;
    } catch (e) {
      await prisma.announcementDelivery.update({ where: { announcementId_userId: { announcementId: a.id, userId: u.id }, }, data: { status: "FAILED", error: (e instanceof Error ? e.message : String(e)).slice(0, 300) } });
      failed++;
    }
    await new Promise((res) => setTimeout(res, 250));
  }

  const [sentTotal, failedTotal] = await Promise.all([
    prisma.announcementDelivery.count({ where: { announcementId: a.id, status: "SENT" } }),
    prisma.announcementDelivery.count({ where: { announcementId: a.id, status: "FAILED" } }),
  ]);
  const remaining = Math.max(0, todo.length - sent - failed);
  const done = remaining === 0 && failedTotal === 0;
  await prisma.productAnnouncement.update({
    where: { id: a.id },
    data: { sentCount: sentTotal, failedCount: failedTotal, ...(done ? { status: "SENT", sentAt: new Date() } : {}) },
  });
  return { sent, failed, remaining, done };
}

export async function recordOptOut(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return false;
  await prisma.emailOptOut.upsert({ where: { userId }, create: { userId }, update: {} });
  return true;
}
