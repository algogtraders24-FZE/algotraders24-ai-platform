// lib/pwa/helpers.ts
// Pure helpers for the installable app and push notifications (no DOM access: everything is passed in, so it is tested in Node).

export type DevicePlatform = "ios" | "android" | "desktop";

export function detectPlatform(userAgent: string, maxTouchPoints = 0): DevicePlatform {
  // iPadOS 13+ reports itself as a Mac with touch points.
  if (/iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "desktop";
}

/** iOS only allows web push for an app that was ADDED TO THE HOME SCREEN (iOS/iPadOS 16.4+). */
export function pushNeedsHomeScreen(platform: DevicePlatform, standalone: boolean): boolean {
  return platform === "ios" && !standalone;
}

export type InstallHint = "installed" | "prompt" | "ios-steps" | "browser-menu" | "none";

/** What the install card should offer. */
export function installHint(p: { platform: DevicePlatform; standalone: boolean; hasPrompt: boolean }): InstallHint {
  if (p.standalone) return "installed";
  if (p.hasPrompt) return "prompt";
  if (p.platform === "ios") return "ios-steps";
  if (p.platform === "android") return "browser-menu";
  return "none";
}

/** VAPID public key (base64url) -> the bytes PushManager.subscribe wants. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export const INSTALL_DISMISS_DAYS = 30;

/** Has the install banner been dismissed recently? `dismissedAt` is epoch ms or null. */
export function installBannerHidden(dismissedAt: number | null, now: number): boolean {
  return dismissedAt !== null && now - dismissedAt < INSTALL_DISMISS_DAYS * 86_400_000;
}
