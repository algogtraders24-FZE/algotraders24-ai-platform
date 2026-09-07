// services/calendar/config.ts
// AN2 - env-driven configuration for the Economic Calendar, mirroring
// services/news/config.ts: every value has a safe documented default so a
// deploy never depends on an env var being set, but each is overridable
// without a code change.

function readPositiveInt(envVar: string, fallback: number): number {
  const raw = Number(process.env[envVar]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

function readString(envVar: string, fallback: string): string {
  const raw = process.env[envVar];
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim().replace(/\/+$/, "") : fallback;
}

/**
 * Base URL for the FairEconomy calendar feed (the same feed the public
 * ForexFactory calendar renders from). Overridable so the host can be
 * repointed - e.g. to a mirror or a paid tier - without a code change.
 */
export function calendarFeedBaseUrl(): string {
  return readString("CALENDAR_FEED_BASE_URL", "https://nfs.faireconomy.media");
}

/**
 * How long the route caches one upstream fetch, in seconds. The feed
 * itself only regenerates a few times an hour and event times don't move,
 * so 15 min keeps us well clear of any rate limit while still catching
 * same-day forecast revisions.
 */
export function calendarCacheTtlSeconds(): number {
  return readPositiveInt("CALENDAR_CACHE_TTL_SECONDS", 15 * 60);
}

/**
 * Past this age (hours) since the last good fetch, the freshness banner
 * flips to "may be out of date". Generous because the schedule for the
 * current week is stable - a stale copy is still correct about what's
 * coming, only possibly behind on a forecast revision.
 */
export function calendarStaleThresholdMs(): number {
  return readPositiveInt("CALENDAR_STALE_THRESHOLD_HOURS", 6) * 60 * 60 * 1000;
}

export const CALENDAR_SOURCE_LABEL = "ForexFactory / FairEconomy";
export const CALENDAR_PROVIDER = "faireconomy";
