// services/live-results/badge.ts
// The facts shown on a shareable Live Results badge (a PNG that sellers and members can post on forums,
// Telegram or their own site). Pure. Built only from the already-redacted public view model, so it carries
// percentages and counts, never money, and states what the number is (terminal-reported, not verified).

import type { PublicResults } from "./build";

export interface BadgeFacts {
  title: string;
  modeLabel: "DEMO" | "REAL" | "CONTEST";
  live: boolean;
  /** The main line: the real forward record (trades closed after live tracking started). */
  headline: string;
  tone: "pos" | "neg" | "neutral";
  sub: string;
}

export const BADGE_TITLE_MAX = 26;

const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

export function badgeFacts(r: PublicResults): BadgeFacts {
  const lt = r.integrity.liveTracked;
  const days = r.integrity.daysSinceFirstSync;
  let headline: string;
  let tone: BadgeFacts["tone"] = "neutral";
  if (lt.trades > 0 && lt.gainPct !== null) {
    headline = `Live forward ${pct(lt.gainPct)} · ${lt.trades} trade${lt.trades === 1 ? "" : "s"}`;
    tone = lt.gainPct > 0 ? "pos" : lt.gainPct < 0 ? "neg" : "neutral";
  } else {
    headline = "Live tracking started · no closed trades yet";
  }
  const modeLabel = r.mode === "real" ? "REAL" : r.mode === "contest" ? "CONTEST" : "DEMO";
  const dd = `max drawdown ${r.stats.maxDrawdownPct.toFixed(1)}%`;
  return {
    title: truncate(r.title, BADGE_TITLE_MAX),
    modeLabel,
    live: !r.integrity.stale,
    headline,
    tone,
    sub: `Tracked ${days} day${days === 1 ? "" : "s"} · ${dd} · terminal-reported`,
  };
}
