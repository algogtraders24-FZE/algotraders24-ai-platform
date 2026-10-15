// services/seo/indexnow.ts
// IndexNow (Bing, Yandex, Seznam, Naver...): tell participating search engines which URLs are new or changed, so they are crawled
// within hours instead of days. Google does not use IndexNow (it reads the sitemap). Pure selection + request building here; the
// cron route supplies the data and the fetch. The key is public by design (it must be served from /<key>.txt to prove ownership).

export const INDEXNOW_KEY = "e8a64fbb19347bd1028f4ca201dfceb9";
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const HOUR = 3_600_000;
/** IndexNow accepts up to 10,000 URLs per request; stay far below it. */
const MAX_URLS = 200;

export interface IndexNowCandidates {
  /** Always-fresh pages (market hubs, scoreboard) that change every day. */
  alwaysFresh: readonly string[];
  posts: ReadonlyArray<{ slug: string; publishedAt: string | null }>;
  listings: ReadonlyArray<{ slug: string; updatedAt: Date | string }>;
}

/** URLs worth pinging now: always-fresh pages, plus blog posts published and listings updated within `windowHours`. Deduplicated, capped. */
export function selectIndexNowUrls(c: IndexNowCandidates, siteUrl: string, nowMs: number, windowHours = 30): string[] {
  const since = nowMs - windowHours * HOUR;
  const base = siteUrl.replace(/\/+$/, "");
  const urls = new Set<string>();
  for (const p of c.alwaysFresh) urls.add(`${base}${p.startsWith("/") ? "" : "/"}${p}`);
  for (const p of c.posts) {
    const t = p.publishedAt ? new Date(p.publishedAt).getTime() : NaN;
    if (Number.isFinite(t) && t >= since && t <= nowMs + HOUR) urls.add(`${base}/blog/${p.slug}`);
  }
  for (const l of c.listings) {
    const t = new Date(l.updatedAt).getTime();
    if (Number.isFinite(t) && t >= since && t <= nowMs + HOUR) urls.add(`${base}/marketplace/${l.slug}`);
  }
  return [...urls].slice(0, MAX_URLS);
}

export function buildIndexNowRequest(siteUrl: string, urls: readonly string[], key: string = INDEXNOW_KEY) {
  const host = new URL(siteUrl).host;
  return {
    url: INDEXNOW_ENDPOINT,
    init: {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host, key, keyLocation: `${siteUrl.replace(/\/+$/, "")}/${key}.txt`, urlList: urls }),
    },
  };
}

export interface IndexNowResult {
  submitted: number;
  /** HTTP status from IndexNow (200/202 = accepted), or null when nothing was sent / the call failed. */
  status: number | null;
}

export async function pingIndexNow(
  siteUrl: string,
  c: IndexNowCandidates,
  deps: { fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<IndexNowResult> {
  const urls = selectIndexNowUrls(c, siteUrl, (deps.now ?? Date.now)());
  if (urls.length === 0) return { submitted: 0, status: null };
  const req = buildIndexNowRequest(siteUrl, urls);
  try {
    const res = await (deps.fetchImpl ?? fetch)(req.url, req.init);
    return { submitted: urls.length, status: res.status };
  } catch {
    return { submitted: urls.length, status: null };
  }
}
