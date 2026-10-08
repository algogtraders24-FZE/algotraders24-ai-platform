// services/live-results/watch-rules.ts
// When should a member who WATCHES a Live Results page be told that it stopped reporting, or that it is back?
// Pure. One message per outage (not per sweep), never when the page was already quiet before the member started
// watching, and a minimum gap before a NEW "stopped" so a flaky connection cannot spam the bell.

export const WATCH_STALE_AFTER_MS = 10 * 60_000;
export const WATCH_MIN_GAP_MS = 60 * 60_000;

export const WATCH_KIND_STALE = "live_results_stale";
export const WATCH_KIND_RESUMED = "live_results_resumed";
export type WatchKind = typeof WATCH_KIND_STALE | typeof WATCH_KIND_RESUMED;

export type WatchAction = "stopped" | "resumed" | "none";

export interface WatchInput {
  /** When the member started watching (UTC ms). */
  followedAt: number;
  /** Newest data the page's account has sent (UTC ms). */
  lastSyncAt: number;
  nowUtc: number;
  /** The newest watch notification this member already got for this page, if any. */
  last: { kind: WatchKind; at: number } | null;
}

export function watchDecision(i: WatchInput): WatchAction {
  const stale = i.nowUtc - i.lastSyncAt >= WATCH_STALE_AFTER_MS;
  if (stale) {
    if (i.last?.kind === WATCH_KIND_STALE) return "none"; // already told for this outage
    if (i.lastSyncAt < i.followedAt) return "none"; // it was already quiet when they started watching: not a change
    if (i.last && i.nowUtc - i.last.at < WATCH_MIN_GAP_MS) return "none"; // anti-flap: a new 'stopped' soon after 'resumed' waits
    return "stopped";
  }
  // Recovery is always announced right away (it only follows a 'stopped' notice).
  return i.last?.kind === WATCH_KIND_STALE ? "resumed" : "none";
}

export function watchMessage(action: "stopped" | "resumed", title: string, minutesQuiet: number): { title: string; body: string; severity: "warning" | "info" } {
  if (action === "stopped") {
    return {
      title: `${title} stopped reporting`,
      body: `No new data for about ${minutesQuiet} minutes. The owner's terminal may be off or disconnected. You are watching this page; its numbers stay as last reported until it is back.`,
      severity: "warning",
    };
  }
  return { title: `${title} is reporting again`, body: "New data is arriving again. You are watching this page.", severity: "info" };
}
