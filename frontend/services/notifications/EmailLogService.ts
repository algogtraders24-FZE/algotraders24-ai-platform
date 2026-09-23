// services/notifications/EmailLogService.ts
// Delivery-outcome logging for EmailService.dispatch(). The `EmailLog`
// table's migration (prisma/migrations/20260921120000_add_email_log) is
// generated but NOT yet applied to the database - every call here is
// wrapped so a missing table (or any other DB error) degrades to a
// console.warn, never a thrown error. Logging email delivery must never be
// the reason an actual email send (or the domain action that triggered it)
// fails.
import "server-only";
import { prisma } from "@/lib/prisma";

export async function recordEmailLog(params: {
  type: string;
  recipientEmail: string;
  recipientUserId?: string;
  dedupeKey?: string;
  status: "SENT" | "SKIPPED" | "FAILED";
  providerMessageId?: string;
  errorMessage?: string;
}): Promise<void> {
  try {
    await prisma.emailLog.create({
      data: {
        type: params.type,
        recipientEmail: params.recipientEmail,
        recipientUserId: params.recipientUserId ?? null,
        dedupeKey: params.dedupeKey ?? null,
        status: params.status,
        providerMessageId: params.providerMessageId ?? null,
        errorMessage: params.errorMessage ?? null,
      },
    });
  } catch (err) {
    console.warn("[email] failed to record EmailLog (non-fatal)", err instanceof Error ? err.message : err);
  }
}

/** Has this exact (type, dedupeKey) pair already been sent? Used by polled/
 *  computed notifications (credits thresholds, renewal reminders) that have
 *  no naturally-idempotent domain event to key off of. Fails OPEN (returns
 *  false, i.e. "not yet sent") on any DB error - until the migration is
 *  applied this always returns false, meaning dedupe-dependent callers must
 *  not go live until then (see the EmailLog migration's own status note). */
export async function wasEmailAlreadySent(type: string, dedupeKey: string): Promise<boolean> {
  try {
    const existing = await prisma.emailLog.findUnique({ where: { type_dedupeKey: { type, dedupeKey } } });
    return existing !== null && existing.status !== "FAILED";
  } catch (err) {
    console.warn("[email] failed to check EmailLog dedupe (non-fatal, treating as not-yet-sent)", err instanceof Error ? err.message : err);
    return false;
  }
}
