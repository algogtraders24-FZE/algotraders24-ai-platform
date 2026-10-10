// services/push/deliver.ts
// Sends one notification to every device a user enabled it on. Best effort by design: it never throws and never blocks an
// alert. A push service answering 404/410 means the device unsubscribed or uninstalled, so that subscription is deleted;
// repeated other failures also remove it. The actual HTTP call is injected (tests use a fake; production uses web-push).

import { pushConfig } from "./config";
import { prismaPushStore, MAX_FAILURES, type PushStore, type SubRow } from "./store";
import { buildPayload, isAllowedPushEndpoint, type PushPayload } from "./subscription";

export type PushKind = "alerts" | "watch";

export interface SendOutcome {
  ok: boolean;
  /** HTTP status from the push service, 0 for a network error. */
  status: number;
}

export type PushSender = (sub: { endpoint: string; p256dh: string; auth: string }, payload: PushPayload) => Promise<SendOutcome>;

export interface PushDeps {
  store?: PushStore;
  send?: PushSender;
  enabled?: boolean;
  now?: () => Date;
}

/** The production sender: web-push with the VAPID keys, short timeout, TTL of an hour (an old alert is worthless). */
export async function productionSender(): Promise<PushSender> {
  const cfg = pushConfig();
  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
  return async (sub, payload) => {
    try {
      const res = await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 3600, timeout: 8000, urgency: "high" });
      return { ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode };
    } catch (e) {
      const status = typeof (e as { statusCode?: unknown }).statusCode === "number" ? (e as { statusCode: number }).statusCode : 0;
      return { ok: false, status };
    }
  };
}

/** Returns how many devices accepted the notification. */
export async function sendPushToUser(userId: string, kind: PushKind, message: { title: string; body?: string; url?: string; tag?: string }, deps: PushDeps = {}): Promise<number> {
  try {
    if (!(deps.enabled ?? pushConfig().enabled)) return 0;
    const store = deps.store ?? prismaPushStore();
    const subs = (await store.listByUser(userId)).filter((s: SubRow) => (kind === "alerts" ? s.alertsOn : s.watchOn) && isAllowedPushEndpoint(s.endpoint));
    if (subs.length === 0) return 0;
    const send = deps.send ?? (await productionSender());
    const payload = buildPayload(message);
    let accepted = 0;
    for (const s of subs) {
      const out = await send({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload).catch((): SendOutcome => ({ ok: false, status: 0 }));
      if (out.ok) {
        accepted++;
        await store.markSent(s.id, (deps.now ?? (() => new Date()))()).catch(() => undefined);
      } else if (out.status === 404 || out.status === 410) {
        await store.removeById(s.id).catch(() => undefined);
      } else {
        await store.markFailed(s.id).catch(() => undefined);
        if (s.failures + 1 >= MAX_FAILURES) await store.removeById(s.id).catch(() => undefined);
      }
    }
    return accepted;
  } catch {
    return 0;
  }
}
