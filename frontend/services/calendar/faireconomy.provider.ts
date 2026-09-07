// services/calendar/faireconomy.provider.ts
// AN2 - the ONE real HTTP-calling function for the FairEconomy weekly
// economic-calendar feed (the same JSON the public ForexFactory calendar
// renders from). Field shapes below are grounded in a real fetch of
// https://nfs.faireconomy.media/ff_calendar_thisweek.json made during AN2
// design, not guessed:
//
//   [{ "title": "Main Refinancing Rate", "country": "EUR",
//      "date": "2026-09-10T08:15:00-04:00", "impact": "High",
//      "forecast": "2.65%", "previous": "2.40%" }, ...]
//
// Confirmed absent from the free feed: `actual`. Only `thisweek` resolves
// today - `nextweek`/`lastweek` return 404 - so AN2 ships the current week
// only (see CALENDAR_WEEKS).
import "server-only";
import { calendarCacheTtlSeconds, calendarFeedBaseUrl, CALENDAR_PROVIDER } from "./config";
import type { CalendarWeek } from "@/types/economic-calendar";

export type CalendarProviderErrorKind = "http_error" | "invalid_response" | "timeout" | "unknown";

export class CalendarProviderError extends Error {
  constructor(
    public readonly kind: CalendarProviderErrorKind,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CalendarProviderError";
  }
}

/** Verbatim shape of one feed row. Every field is treated as untrusted - normalization validates. */
export interface RawFairEconomyEvent {
  title?: unknown;
  country?: unknown;
  date?: unknown;
  impact?: unknown;
  forecast?: unknown;
  previous?: unknown;
  /** Not currently emitted by the free feed; typed so a future tier that adds it flows straight through. */
  actual?: unknown;
}

const WEEK_TO_FILE: Record<CalendarWeek, string> = {
  this: "ff_calendar_thisweek.json",
};

const FETCH_TIMEOUT_MS = 10_000;

/** Injectable transport - defaults to the platform `fetch`. Only overridden by the validation script (no real network in tests). */
export type CalendarFetch = typeof fetch;

/**
 * Fetches and JSON-parses one week's feed. Returns the raw array untouched
 * - the caller (normalize.service) is responsible for validating and
 * shaping each row. Throws CalendarProviderError on any transport or
 * parse failure; never returns a partial result.
 *
 * The fetch is cached by Next.js for `calendarCacheTtlSeconds()` so a
 * burst of page loads collapses to one upstream request.
 */
export async function fetchFairEconomyWeek(week: CalendarWeek, fetchImpl: CalendarFetch = fetch): Promise<RawFairEconomyEvent[]> {
  const url = `${calendarFeedBaseUrl()}/${WEEK_TO_FILE[week]}`;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      // A browser-like UA - the CDN 403s the default undici UA.
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AT24Calendar/1.0)" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      next: { revalidate: calendarCacheTtlSeconds(), tags: ["economic-calendar"] },
    });
  } catch (error) {
    const kind: CalendarProviderErrorKind = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "unknown";
    throw new CalendarProviderError(kind, `Failed to reach the ${CALENDAR_PROVIDER} calendar feed`, error);
  }

  if (!res.ok) {
    throw new CalendarProviderError("http_error", `${CALENDAR_PROVIDER} calendar feed returned HTTP ${res.status}`);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (error) {
    throw new CalendarProviderError("invalid_response", `${CALENDAR_PROVIDER} calendar feed did not return valid JSON`, error);
  }

  if (!Array.isArray(body)) {
    throw new CalendarProviderError("invalid_response", `${CALENDAR_PROVIDER} calendar feed was not a JSON array`);
  }

  return body as RawFairEconomyEvent[];
}
