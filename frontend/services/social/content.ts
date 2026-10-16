// services/social/content.ts
// The posts AT24 prepares for its own social accounts - pure functions, no I/O. Three kinds: the daily range card, the weekly
// calibration scoreboard and new blog analyses. Every post states a measured number or a published article; none gives a
// direction, a target or an instruction, every one carries the not-financial-advice line, and the text never claims more than the
// data says (a scoreboard row with fewer than 30 checked forecasts is reported as "collecting", not as a result).

import type { HubView } from "@/services/markets/hub";
import { MIN_SAMPLE, TARGET_COVERAGE, type CalibrationRow } from "@/services/calibration/forecast";

export type SocialKind = "daily_card" | "scoreboard" | "blog";

export interface DraftPost {
  kind: SocialKind;
  dedupeKey: string;
  title: string;
  /** Full caption (Instagram, LinkedIn, webhook). */
  text: string;
  /** Telegram photo caption (hard limit 1024 characters). */
  shortText: string;
  /** Site-relative path of the JPEG card. */
  imagePath: string;
  linkUrl: string | null;
}

const DISCLAIMER = "Not financial advice. A volatility range, not a direction or a target.";
const TELEGRAM_CAPTION_MAX = 900;

export const dayKey = (d: Date): string => d.toISOString().slice(0, 10);
const dayLabel = (d: Date): string => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/** "12h +/-18.71 (0.45%)" -> "+/-18.71 (0.45%)": the part after the horizon label. */
export const rangeOnly = (r12: string): string => r12.replace(/^12h\s*/, "");

export function buildDailyPost(views: readonly HubView[], now: Date, siteUrl: string): DraftPost | null {
  const rows = views.filter((v) => v.ranges);
  if (rows.length < 3) return null; // too little data to publish an honest card
  const widened = rows.filter((v) => v.ranges?.widenedNote);
  const lines = rows.map((v) => `• ${v.def.name}: ${rangeOnly(v.ranges!.r12)}`);
  const head = `AT24 daily range check - ${dayLabel(now)}\n\nHow far each market typically moves over the next 12 hours (about ${TARGET_COVERAGE * 100}% of past moves stayed within):`;
  const note = widened.length > 0 ? `\n\nA scheduled US release falls inside the window for ${widened.map((v) => v.def.name).join(", ")}: those ranges are widened.` : "";
  const tail = `\n\nLive ranges, key levels and drivers: ${siteUrl}/markets\n\n${DISCLAIMER}\n\n#Gold #Forex #Bitcoin #Trading`;
  const text = `${head}\n${lines.join("\n")}${note}${tail}`;
  const short = `${head}\n${lines.join("\n")}${note}\n\n${siteUrl}/markets\n${DISCLAIMER}`;
  return {
    kind: "daily_card",
    dedupeKey: `daily:${dayKey(now)}`,
    title: `Daily range check ${dayKey(now)}`,
    text,
    shortText: clip(short, TELEGRAM_CAPTION_MAX),
    imagePath: `/social/card/daily.jpg?d=${dayKey(now)}`,
    linkUrl: `${siteUrl}/markets`,
  };
}

const pct = (v: number | null) => (v === null ? "-" : `${Math.round(v * 100)}%`);

export function buildScoreboardPost(all: readonly CalibrationRow[], now: Date, siteUrl: string): DraftPost | null {
  const rows = all.filter((r) => r.n > 0);
  if (rows.length === 0) return null; // nothing checked yet: nothing honest to post
  const lines = rows.map((r) =>
    r.status === "collecting"
      ? `• ${r.horizon}h window: ${r.n} forecasts checked so far, ${pct(r.rate)} stayed inside - too few for a verdict (we need ${MIN_SAMPLE})`
      : `• ${r.horizon}h window: ${pct(r.rate)} stayed inside over ${r.n} checked forecasts (target ${TARGET_COVERAGE * 100}%)`,
  );
  const text = `Do our ranges hold up? Weekly scoreboard - ${dayLabel(now)}\n\nEvery few hours we state how far a market typically moves and check it afterwards. Every forecast counts, none is removed.\n\n${lines.join("\n")}\n\nThe live scoreboard: ${siteUrl}/calibration\n\n${DISCLAIMER}\n\n#Trading #Transparency #Gold #Forex`;
  const short = `Do our ranges hold up? Weekly scoreboard - ${dayLabel(now)}\n\n${lines.join("\n")}\n\n${siteUrl}/calibration\n${DISCLAIMER}`;
  return {
    kind: "scoreboard",
    dedupeKey: `scoreboard:${dayKey(now)}`,
    title: `Weekly scoreboard ${dayKey(now)}`,
    text,
    shortText: clip(short, TELEGRAM_CAPTION_MAX),
    imagePath: `/social/card/scoreboard.jpg?d=${dayKey(now)}`,
    linkUrl: `${siteUrl}/calibration`,
  };
}

export function buildBlogPost(post: { slug: string; title: string; excerpt?: string }, siteUrl: string): DraftPost {
  const url = `${siteUrl}/blog/${post.slug}`;
  const excerpt = post.excerpt ? `\n\n${clip(post.excerpt.replace(/\s+/g, " ").trim(), 220)}` : "";
  const text = `New analysis: ${post.title}${excerpt}\n\nRead it: ${url}\n\n${DISCLAIMER}\n\n#Trading #MarketAnalysis`;
  return {
    kind: "blog",
    dedupeKey: `blog:${post.slug}`,
    title: post.title,
    text,
    shortText: clip(`New analysis: ${post.title}${excerpt}\n\n${url}\n${DISCLAIMER}`, TELEGRAM_CAPTION_MAX),
    imagePath: `/social/card/blog/${post.slug}/card.jpg`,
    linkUrl: url,
  };
}

/** Words that would turn a post into a call; the generators never produce them, and the admin edit box refuses them. */
const CALL_WORDS = /\b(buy now|sell now|go long|go short|guaranteed|can'?t lose|sure shot|price target|will (rise|fall|reach|moon))\b/i;
export function violatesPolicy(text: string): string | null {
  const m = CALL_WORDS.exec(text);
  return m ? `contains "${m[0]}" (no buy / sell calls, targets or guarantees)` : null;
}
