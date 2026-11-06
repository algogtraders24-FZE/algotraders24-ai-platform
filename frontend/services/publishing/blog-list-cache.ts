// services/publishing/blog-list-cache.ts
// Cache for the public blog LIST. Reading it means loading every published post's full content (to verify each hash), which is
// the biggest single source of database egress: the market hubs, /blog, /markets, market-insights, the sitemap, IndexNow, every
// /blog/<slug> page and the 15-minute social cron all call listPosts(), so the same ~45-70 full articles were pulled thousands of
// times a month (Supabase Free-plan egress 12.9 GB against a 0.18 GB database, Nov 2026).
//
// Two layers, both short-lived so a newly published post still appears within TTL:
//  1. in-process memo with single flight (concurrent callers share one load, a failed load is not kept);
//  2. Next's shared Data Cache (unstable_cache) so separate serverless instances share one read as well. Outside a Next runtime
//     (tsx scripts) that call throws; it then falls back to a plain load, and never loads twice when the load itself failed.
import { unstable_cache } from "next/cache";
import type { BlogPostSummary } from "@/types/publishing/blog-contract";

export const BLOG_LIST_TTL_SECONDS = 600;
export const BLOG_LIST_TAG = "blog-posts";

type Compute = () => Promise<BlogPostSummary[]>;

let memo: { at: number; value: Promise<BlogPostSummary[]> } | null = null;

export function resetBlogListMemo(): void {
  memo = null;
}

async function sharedLoad(compute: Compute): Promise<BlogPostSummary[]> {
  let started = false;
  const counted: Compute = async () => {
    started = true;
    return compute();
  };
  try {
    return await unstable_cache(counted, ["blog-list-v1"], { revalidate: BLOG_LIST_TTL_SECONDS, tags: [BLOG_LIST_TAG] })();
  } catch (err) {
    if (started) throw err; // the load itself failed: do not run it a second time
    return compute(); // no Next cache available (script / test): plain load
  }
}

export async function cachedBlogList(compute: Compute, now: () => number = Date.now): Promise<BlogPostSummary[]> {
  const t = now();
  if (memo && t - memo.at < BLOG_LIST_TTL_SECONDS * 1000) return memo.value.then((v) => v.slice());
  const value = sharedLoad(compute);
  memo = { at: t, value };
  value.catch(() => {
    if (memo && memo.value === value) memo = null; // a failed load must not be kept for ten minutes
  });
  return value.then((v) => v.slice()); // callers get their own array, so one caller sorting it cannot change another's
}
