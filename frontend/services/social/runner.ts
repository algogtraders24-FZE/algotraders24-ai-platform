// services/social/runner.ts
// One idempotent pass, run every 15 minutes: (1) prepare today's posts when they are due and not yet prepared, (2) send the ones
// that were approved. Dependencies are injected so the whole loop is tested offline. Never throws to the cron.
//
// Drafts are created once per dedupeKey (daily:<date>, scoreboard:<date>, blog:<slug>) and sent once: a re-run, an overlapping
// run or a retry can never produce a second post. Posts start as DRAFT for the owner to approve. SOCIAL_AUTO_APPROVE=daily
// auto-approves ONLY the daily range card and the Monday scoreboard (about one post a day, runs on the server with the
// owner's computer off); =on auto-approves everything, including every new analysis.

import type { HubView } from "@/services/markets/hub";
import type { CalibrationRow } from "@/services/calibration/forecast";
import { buildBlogPost, buildDailyPost, buildScoreboardPost, type DraftPost } from "./content";
import { dispatchPost, type ChannelResults, type DispatchDeps, type SendablePost } from "./dispatch";

export const MAX_ATTEMPTS = 3;
const HOUR = 3_600_000;

export interface StoredPost extends SendablePost {
  attempts: number;
}

export interface SocialStore {
  /** Inserts when the dedupeKey is new; false when it already existed. */
  createIfNew(draft: DraftPost, status: "DRAFT" | "APPROVED"): Promise<boolean>;
  /** APPROVED posts that still have attempts left, oldest first. */
  listApproved(): Promise<StoredPost[]>;
  markSent(id: string, results: ChannelResults): Promise<void>;
  /** `final` = out of attempts: status FAILED; otherwise it stays APPROVED for the next pass. */
  markAttempt(id: string, results: ChannelResults, error: string | null, final: boolean): Promise<void>;
}

export interface SocialSources {
  hubs: () => Promise<HubView[]>;
  scoreboard: () => Promise<CalibrationRow[]>;
  recentPosts: () => Promise<Array<{ slug: string; title: string; excerpt?: string; publishedAt: string | null }>>;
}

/** false = the owner approves each post; "daily" = only the daily card and the scoreboard go out by themselves; true = everything does. */
export type AutoApprove = boolean | "daily";

export function parseAutoApprove(value: string | undefined): AutoApprove {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "daily") return "daily";
  return v === "on";
}

export interface SocialDeps {
  store: SocialStore;
  sources: SocialSources;
  dispatch: DispatchDeps;
  siteUrl: string;
  autoApprove: AutoApprove;
}

export interface SocialRunResult {
  drafted: number;
  sent: number;
  failed: number;
  waiting: number;
}

const isWeekday = (d: Date) => d.getUTCDay() >= 1 && d.getUTCDay() <= 5;
const afterUtc = (d: Date, h: number, m = 0) => d.getUTCHours() > h || (d.getUTCHours() === h && d.getUTCMinutes() >= m);

export async function runSocialWith(deps: SocialDeps, now: Date = new Date()): Promise<SocialRunResult> {
  const out: SocialRunResult = { drafted: 0, sent: 0, failed: 0, waiting: 0 };
  const statusFor = (draft: DraftPost): "DRAFT" | "APPROVED" =>
    deps.autoApprove === true || (deps.autoApprove === "daily" && (draft.kind === "daily_card" || draft.kind === "scoreboard")) ? "APPROVED" : "DRAFT";
  const add = async (draft: DraftPost | null) => {
    if (!draft) return;
    try {
      if (await deps.store.createIfNew(draft, statusFor(draft))) out.drafted++;
    } catch {
      /* table absent or a transient DB error: the next pass tries again */
    }
  };

  // 1) prepare
  try {
    if (isWeekday(now) && afterUtc(now, 5, 30)) await add(buildDailyPost(await deps.sources.hubs(), now, deps.siteUrl));
    if (now.getUTCDay() === 1 && afterUtc(now, 6, 0)) await add(buildScoreboardPost(await deps.sources.scoreboard(), now, deps.siteUrl));
    const since = now.getTime() - 26 * HOUR;
    for (const p of await deps.sources.recentPosts()) {
      const t = p.publishedAt ? new Date(p.publishedAt).getTime() : NaN;
      if (Number.isFinite(t) && t >= since && t <= now.getTime() + HOUR) await add(buildBlogPost(p, deps.siteUrl));
    }
  } catch {
    /* a failing source leaves that post for the next pass */
  }

  // 2) send what was approved
  let approved: StoredPost[] = [];
  try {
    approved = await deps.store.listApproved();
  } catch {
    return out;
  }
  for (const post of approved) {
    const r = await dispatchPost(post, deps.dispatch);
    if (r.sent) {
      await deps.store.markSent(post.id, r.results);
      out.sent++;
    } else {
      const final = post.attempts + 1 >= MAX_ATTEMPTS;
      await deps.store.markAttempt(post.id, r.results, r.error, final);
      if (final) out.failed++;
      else out.waiting++;
    }
  }
  return out;
}
