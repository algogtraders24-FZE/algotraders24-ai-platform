// services/push/subscription.ts
// Validation of a browser PushSubscription before it is stored, and the payload of a notification. Pure.
//
// SECURITY: the server later POSTs to the subscription's endpoint, a URL chosen by whoever registers it. Without a strict
// allow-list a signed-in user could register an internal address and make the server call it (SSRF). So the endpoint must be
// https, must have no credentials, no port other than 443, no IP literal, and its host must be one of the real push services.

export const MAX_SUBSCRIPTIONS_PER_USER = 5;

const PUSH_HOSTS_EXACT = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "push.services.mozilla.com", "web.push.apple.com"];
const PUSH_HOST_SUFFIXES = [".push.apple.com", ".notify.windows.com", ".push.services.mozilla.com"];

export function isAllowedPushEndpoint(endpoint: unknown): boolean {
  if (typeof endpoint !== "string" || endpoint.length < 20 || endpoint.length > 700) return false;
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username !== "" || u.password !== "" || (u.port !== "" && u.port !== "443")) return false;
  const host = u.hostname.toLowerCase();
  if (/^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) return false; // IPv4 / IPv6 literals
  if (PUSH_HOSTS_EXACT.includes(host)) return true;
  return PUSH_HOST_SUFFIXES.some((s) => host.endsWith(s) && host.length > s.length);
}

export interface ValidSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

const B64URL = /^[A-Za-z0-9_-]+$/;

/** A browser PushSubscription JSON ({endpoint, keys:{p256dh, auth}}) -> the three fields we store, or an error message. */
export function parseSubscription(raw: unknown): ValidSubscription | string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return "subscription must be an object";
  const o = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (!isAllowedPushEndpoint(o.endpoint)) return "That push address is not from a supported push service.";
  const keys = o.keys;
  if (typeof keys !== "object" || keys === null) return "subscription keys are missing";
  // p256dh = 65-byte P-256 point (87 chars), auth = 16 random bytes (22 chars); some browsers pad with '='.
  const p = typeof keys.p256dh === "string" ? keys.p256dh.replace(/=+$/, "") : "";
  const a = typeof keys.auth === "string" ? keys.auth.replace(/=+$/, "") : "";
  if (!B64URL.test(p) || p.length !== 87) return "invalid p256dh key";
  if (!B64URL.test(a) || a.length < 20 || a.length > 24) return "invalid auth secret";
  return { endpoint: o.endpoint as string, p256dh: p, auth: a };
}

// ---------------------------------------------------------------- notification payload
export interface PushPayload {
  title: string;
  body: string;
  /** A same-origin PATH to open when the notification is tapped. */
  url: string;
  tag: string;
}

/** Only a path on our own site: "/dashboard/live-sync", never "//evil", "https://evil", "javascript:" or a backslash trick. */
export function safeNotificationPath(url: unknown): string {
  if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//") || url.includes("\\") || /[\u0000-\u001f]/.test(url)) return "/dashboard";
  return url.slice(0, 200);
}

const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export function buildPayload(p: { title: string; body?: string; url?: string; tag?: string }): PushPayload {
  return { title: clean(p.title, 90) || "AT24", body: clean(p.body ?? "", 200), url: safeNotificationPath(p.url), tag: clean(p.tag ?? "at24", 40) || "at24" };
}
