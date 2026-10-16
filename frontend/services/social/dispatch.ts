// services/social/dispatch.ts
// Sends ONE approved post to the configured channels: the AT24 Telegram channel (photo + caption, directly) and a webhook
// (Make / Zapier / n8n), which fans the same payload out to Instagram, LinkedIn and X through their already-approved
// integrations. Pure apart from the injected senders, so it is tested offline. A post counts as SENT when at least one channel
// accepted it; every channel's outcome is stored.

export interface SendablePost {
  id: string;
  kind: string;
  title: string;
  text: string;
  shortText: string;
  imagePath: string;
  linkUrl: string | null;
}

export interface DispatchDeps {
  siteUrl: string;
  /** Posts the photo to the Telegram channel; null when Telegram is not configured. */
  telegram: ((photoUrl: string, caption: string) => Promise<{ ok: boolean; description?: string }>) | null;
  /** POSTs the payload to the automation webhook; null when no webhook is configured. */
  webhook: ((payload: WebhookPayload) => Promise<{ ok: boolean; status: number }>) | null;
}

export interface WebhookPayload {
  id: string;
  kind: string;
  title: string;
  text: string;
  imageUrl: string;
  linkUrl: string | null;
}

export type ChannelResults = Partial<Record<"telegram" | "webhook", string>>;

export interface DispatchResult {
  sent: boolean;
  results: ChannelResults;
  error: string | null;
}

export const absoluteImage = (siteUrl: string, imagePath: string): string => (/^https?:\/\//i.test(imagePath) ? imagePath : `${siteUrl.replace(/\/+$/, "")}${imagePath.startsWith("/") ? "" : "/"}${imagePath}`);

export async function dispatchPost(post: SendablePost, deps: DispatchDeps): Promise<DispatchResult> {
  const results: ChannelResults = {};
  const imageUrl = absoluteImage(deps.siteUrl, post.imagePath);

  if (deps.telegram) {
    try {
      const r = await deps.telegram(imageUrl, post.shortText);
      results.telegram = r.ok ? "ok" : (r.description ?? "failed");
    } catch (e) {
      results.telegram = (e as Error).message || "failed";
    }
  }
  if (deps.webhook) {
    try {
      const r = await deps.webhook({ id: post.id, kind: post.kind, title: post.title, text: post.text, imageUrl, linkUrl: post.linkUrl });
      results.webhook = r.ok ? "ok" : `http ${r.status}`;
    } catch (e) {
      results.webhook = (e as Error).message || "failed";
    }
  }

  const configured = Object.keys(results).length;
  if (configured === 0) return { sent: false, results, error: "No channel is configured (set TELEGRAM_CHANNEL_ID and/or SOCIAL_WEBHOOK_URL)." };
  const ok = Object.values(results).some((v) => v === "ok");
  return { sent: ok, results, error: ok ? null : Object.entries(results).map(([k, v]) => `${k}: ${v}`).join("; ") };
}

/** Builds the webhook sender: JSON POST, optional shared secret header, 8 s timeout, never throws. */
export function makeWebhookSender(url: string, secret: string | undefined, fetchImpl: typeof fetch = fetch): NonNullable<DispatchDeps["webhook"]> {
  return async (payload) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...(secret ? { "x-at24-secret": secret } : {}) },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      return { ok: res.status >= 200 && res.status < 300, status: res.status };
    } catch {
      return { ok: false, status: 0 };
    } finally {
      clearTimeout(timer);
    }
  };
}
