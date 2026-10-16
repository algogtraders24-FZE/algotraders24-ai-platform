// Social outbox: honest content (measured numbers, no calls), one idempotent pass that prepares drafts when due and sends approved
// posts once, retries then gives up, every channel's outcome stored, and the Telegram / webhook senders behave. Offline.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildBlogPost, buildDailyPost, buildScoreboardPost, violatesPolicy, type DraftPost } from "../services/social/content";
import { dispatchPost, makeWebhookSender, absoluteImage, type DispatchDeps } from "../services/social/dispatch";
import { MAX_ATTEMPTS, runSocialWith, type SocialDeps, type StoredPost } from "../services/social/runner";
import { MARKETS, buildHubView, marketBySlug, type HubView } from "../services/markets/hub";
import { createTelegramClient, type FetchLike } from "../services/telegram/client";
import type { CalibrationRow } from "../services/calibration/forecast";
import type { SmcAnalysis } from "../services/smc/smc-engine";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL - ${name}\n    ${(e as Error).message}`);
  }
}
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const SITE = "https://www.algotraders24.ai";

const smc = (price: number, atr: number) => ({ price, atr, bias: "Bullish", htf: { bias: "Bullish", event: "-" }, volatility: "Normal", volatilityRatio: 1, pools: [] }) as unknown as SmcAnalysis;
const NOW_MON = new Date("2026-10-19T06:30:00Z"); // a Monday
const hubs = (events: unknown = []): HubView[] =>
  MARKETS.map((m, i) => buildHubView(m, { smc: smc(1000 + i * 100, 5 + i), macro: null, events: events as never, calibration: null, posts: null, listings: null }, NOW_MON.getTime()));
const cal = (h: 12 | 24, n: number, inside: number): CalibrationRow => ({ symbol: "ALL", horizon: h, n, inside, rate: n ? inside / n : null, lo: 0.7, hi: 0.9, status: n >= 30 ? "on-target" : "collecting" });

async function main() {
  await test("daily post: one line per market with the 12h range, the disclaimer, a link, <=4 hashtags, Telegram caption <= 900, no direction words", () => {
    const d = buildDailyPost(hubs(), NOW_MON, SITE)!;
    assert.equal(d.kind, "daily_card");
    assert.equal(d.dedupeKey, "daily:2026-10-19");
    for (const m of MARKETS) assert.ok(d.text.includes(`• ${m.name}: +/-`), m.name);
    assert.ok(d.text.includes("Not financial advice") && d.text.includes(`${SITE}/markets`));
    assert.ok((d.text.match(/#\w+/g) ?? []).length <= 4);
    assert.ok(d.shortText.length <= 900);
    assert.equal(violatesPolicy(d.text), null);
    assert.ok(!/\b(bullish|bearish|long|short|buy|sell)\b/i.test(d.text), "no direction words");
    assert.match(d.imagePath, /^\/social\/card\/daily\.jpg\?d=2026-10-19$/);
  });

  await test("daily post: fewer than 3 markets with a range -> no post; a release inside the window is mentioned", () => {
    assert.equal(buildDailyPost(hubs().slice(0, 2), NOW_MON, SITE), null); // two markets are not enough for an honest card
    const empty = MARKETS.map((m) => buildHubView(m, { smc: null, macro: null, events: null, calibration: null, posts: null, listings: null }, NOW_MON.getTime()));
    assert.equal(buildDailyPost(empty, NOW_MON, SITE), null);
    const cpi = [{ title: "CPI m/m", currency: "USD", impact: "high", eventTime: new Date(NOW_MON.getTime() + 3 * 3_600_000).toISOString() }];
    const d = buildDailyPost(hubs(cpi), NOW_MON, SITE)!;
    assert.match(d.text, /A scheduled US release falls inside the window for .*those ranges are widened/);
  });

  await test("scoreboard post: only checked rows; below 30 it says 'collecting' and the need, never a verdict; nothing checked -> no post", () => {
    assert.equal(buildScoreboardPost([cal(12, 0, 0), cal(24, 0, 0)], NOW_MON, SITE), null);
    const p = buildScoreboardPost([cal(12, 12, 9), cal(24, 40, 33)], NOW_MON, SITE)!;
    assert.match(p.text, /12h window: 12 forecasts checked so far, 75% stayed inside - too few for a verdict \(we need 30\)/);
    assert.match(p.text, /24h window: 83% stayed inside over 40 checked forecasts \(target 80%\)/);
    assert.ok(p.text.includes(`${SITE}/calibration`) && p.text.includes("Not financial advice"));
    assert.equal(p.dedupeKey, "scoreboard:2026-10-19");
  });

  await test("blog post: title, excerpt (clipped), link; card path per slug", () => {
    const b = buildBlogPost({ slug: "gold-15-oct", title: "Gold (XAU/USD) Analysis", excerpt: "x ".repeat(300) }, SITE);
    assert.equal(b.dedupeKey, "blog:gold-15-oct");
    assert.ok(b.text.includes(`${SITE}/blog/gold-15-oct`) && b.shortText.length <= 900);
    assert.equal(b.imagePath, "/social/card/blog/gold-15-oct/card.jpg");
    assert.ok(b.text.length < 700);
  });

  await test("policy: buy/sell calls, targets and guarantees are refused", () => {
    for (const bad of ["Buy now before it moves", "price target 4500", "guaranteed profits", "gold will rise tomorrow", "go long here"]) assert.ok(violatesPolicy(bad), bad);
    assert.equal(violatesPolicy("Expected range for gold is +/-18 over 12h."), null);
  });

  const post = (over: Partial<StoredPost> = {}): StoredPost => ({ id: "p1", kind: "daily_card", title: "t", text: "full", shortText: "short", imagePath: "/social/card/daily.jpg?d=1", linkUrl: SITE, attempts: 0, ...over });
  const dispatchDeps = (over: Partial<DispatchDeps> = {}): DispatchDeps & { calls: string[] } => {
    const calls: string[] = [];
    return {
      siteUrl: SITE,
      telegram: async (u, c) => (calls.push(`tg:${u}|${c}`), { ok: true }),
      webhook: async (p) => (calls.push(`wh:${p.imageUrl}|${p.text}`), { ok: true, status: 200 }),
      calls,
      ...over,
    };
  };

  await test("dispatch: both channels get the absolute image URL; Telegram the short caption, the webhook the full text", async () => {
    const d = dispatchDeps();
    const r = await dispatchPost(post(), d);
    assert.deepEqual(r, { sent: true, results: { telegram: "ok", webhook: "ok" }, error: null });
    assert.deepEqual(d.calls, [`tg:${SITE}/social/card/daily.jpg?d=1|short`, `wh:${SITE}/social/card/daily.jpg?d=1|full`]);
    assert.equal(absoluteImage(SITE, "https://cdn/x.jpg"), "https://cdn/x.jpg");
  });

  await test("dispatch: sent when at least one channel accepts, with the other's failure kept; none configured / all failing -> not sent with a reason", async () => {
    const half = await dispatchPost(post(), dispatchDeps({ webhook: async () => ({ ok: false, status: 500 }) }));
    assert.equal(half.sent, true);
    assert.deepEqual(half.results, { telegram: "ok", webhook: "http 500" });
    const none = await dispatchPost(post(), dispatchDeps({ telegram: null, webhook: null }));
    assert.equal(none.sent, false);
    assert.match(none.error ?? "", /No channel is configured/);
    const fail = await dispatchPost(post(), dispatchDeps({ telegram: async () => { throw new Error("boom"); }, webhook: async () => ({ ok: false, status: 0 }) }));
    assert.equal(fail.sent, false);
    assert.match(fail.error ?? "", /telegram: boom; webhook: http 0/);
  });

  // ---- runner ----
  function harness(opts: { autoApprove?: boolean; dispatch?: Partial<DispatchDeps>; posts?: Array<{ slug: string; title: string; publishedAt: string | null }> } = {}) {
    const rows = new Map<string, DraftPost & { id: string; status: string; attempts: number; results?: unknown }>();
    let n = 0;
    const d = dispatchDeps(opts.dispatch);
    const deps: SocialDeps = {
      siteUrl: SITE,
      autoApprove: opts.autoApprove ?? false,
      dispatch: d,
      sources: { hubs: async () => hubs(), scoreboard: async () => [cal(12, 40, 33), cal(24, 40, 32)], recentPosts: async () => opts.posts ?? [] },
      store: {
        createIfNew: async (draft, status) => {
          if (rows.has(draft.dedupeKey)) return false;
          rows.set(draft.dedupeKey, { ...draft, id: `id${++n}`, status, attempts: 0 });
          return true;
        },
        listApproved: async () => [...rows.values()].filter((r) => r.status === "APPROVED").map((r) => ({ id: r.id, kind: r.kind, title: r.title, text: r.text, shortText: r.shortText, imagePath: r.imagePath, linkUrl: r.linkUrl, attempts: r.attempts })),
        markSent: async (id, results) => { const r = [...rows.values()].find((x) => x.id === id)!; r.status = "SENT"; r.results = results; r.attempts++; },
        markAttempt: async (id, _res, _err, final) => { const r = [...rows.values()].find((x) => x.id === id)!; r.attempts++; if (final) r.status = "FAILED"; },
      },
    };
    return { rows, deps, calls: d.calls };
  }

  await test("runner: weekday after 05:30 UTC prepares the daily post as a DRAFT (nothing sent); Monday also the scoreboard; weekends and early hours prepare nothing", async () => {
    const h = harness();
    const r = await runSocialWith(h.deps, NOW_MON);
    assert.equal(r.drafted, 2);
    assert.deepEqual([...h.rows.values()].map((x) => [x.kind, x.status]).sort(), [["daily_card", "DRAFT"], ["scoreboard", "DRAFT"]]);
    assert.equal(h.calls.length, 0);
    const early = harness();
    assert.equal((await runSocialWith(early.deps, new Date("2026-10-19T05:00:00Z"))).drafted, 0);
    const sat = harness();
    assert.equal((await runSocialWith(sat.deps, new Date("2026-10-17T08:00:00Z"))).drafted, 0);
    const tue = harness();
    assert.equal((await runSocialWith(tue.deps, new Date("2026-10-20T08:00:00Z"))).drafted, 1); // daily only
  });

  await test("runner: a second pass the same day drafts nothing new (idempotent); approval then sends exactly once", async () => {
    const h = harness();
    await runSocialWith(h.deps, NOW_MON);
    assert.equal((await runSocialWith(h.deps, new Date(NOW_MON.getTime() + 15 * 60_000))).drafted, 0);
    for (const r of h.rows.values()) r.status = "APPROVED"; // the owner approves
    const sent = await runSocialWith(h.deps, new Date(NOW_MON.getTime() + 30 * 60_000));
    assert.equal(sent.sent, 2);
    assert.equal(h.calls.length, 4); // 2 posts x (telegram + webhook)
    const again = await runSocialWith(h.deps, new Date(NOW_MON.getTime() + 45 * 60_000));
    assert.deepEqual([again.sent, again.drafted, h.calls.length], [0, 0, 4]);
  });

  await test("runner: auto-approve creates APPROVED posts and sends them in the same pass", async () => {
    const h = harness({ autoApprove: true });
    const r = await runSocialWith(h.deps, NOW_MON);
    assert.deepEqual([r.drafted, r.sent], [2, 2]);
  });

  await test("runner: new blog analyses (published in the last 26h) become posts; older ones and unpublished ones do not", async () => {
    const h = harness({ posts: [{ slug: "new", title: "Gold analysis", publishedAt: "2026-10-19T04:00:00Z" }, { slug: "old", title: "Old", publishedAt: "2026-10-10T04:00:00Z" }, { slug: "x", title: "x", publishedAt: null }] });
    await runSocialWith(h.deps, NOW_MON);
    assert.deepEqual([...h.rows.keys()].filter((k) => k.startsWith("blog:")), ["blog:new"]);
  });

  await test("runner: a failing send is retried on the next passes and marked FAILED after 3 attempts (never sent twice, never dropped silently)", async () => {
    const h = harness({ autoApprove: true, dispatch: { telegram: null, webhook: async () => ({ ok: false, status: 500 }) } });
    let r = await runSocialWith(h.deps, NOW_MON);
    assert.deepEqual([r.sent, r.waiting, r.failed], [0, 2, 0]);
    r = await runSocialWith(h.deps, new Date(NOW_MON.getTime() + 15 * 60_000));
    assert.deepEqual([r.sent, r.waiting, r.failed], [0, 2, 0]);
    r = await runSocialWith(h.deps, new Date(NOW_MON.getTime() + 30 * 60_000));
    assert.deepEqual([r.sent, r.waiting, r.failed], [0, 0, 2]);
    assert.equal(MAX_ATTEMPTS, 3);
    assert.ok([...h.rows.values()].every((x) => x.status === "FAILED"));
  });

  await test("runner: a source or store failure never throws", async () => {
    const h = harness();
    h.deps.sources.hubs = async () => { throw new Error("down"); };
    const r = await runSocialWith(h.deps, NOW_MON);
    assert.ok(r.drafted <= 1); // the daily post could not be built; the scoreboard still can
    const dead = harness();
    dead.deps.store.listApproved = async () => { throw new Error("db"); };
    assert.deepEqual(await runSocialWith(dead.deps, NOW_MON), { drafted: 2, sent: 0, failed: 0, waiting: 0 });
  });

  await test("telegram sendPhoto: escapes the caption, cuts it at 1024, posts to sendPhoto with the photo URL; webhook sender adds the secret header and reports non-2xx", async () => {
    const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
    const f: FetchLike = async (url, init) => (seen.push({ url, body: JSON.parse(init.body) }), { status: 200, json: async () => ({ ok: true, result: { message_id: 7 } }) });
    const c = createTelegramClient("T".repeat(30), f);
    const r = await c.sendPhoto("@chan", "https://x/y.jpg", `A & B <b> ${"z".repeat(2000)}`);
    assert.equal(r.ok, true);
    assert.ok(seen[0].url.endsWith("/sendPhoto"));
    assert.equal(seen[0].body.photo, "https://x/y.jpg");
    assert.ok(String(seen[0].body.caption).startsWith("A &amp; B &lt;b&gt;") && String(seen[0].body.caption).length <= 1024);

    let headers: Record<string, string> = {};
    const send = makeWebhookSender("https://hook.example/abc", "s3cret", (async (_u: unknown, init: RequestInit) => (headers = init.headers as Record<string, string>, new Response("ok", { status: 200 }))) as never);
    assert.deepEqual(await send({ id: "1", kind: "k", title: "t", text: "x", imageUrl: "u", linkUrl: null }), { ok: true, status: 200 });
    assert.equal(headers["x-at24-secret"], "s3cret");
    const bad = makeWebhookSender("https://hook.example/abc", undefined, (async () => new Response("no", { status: 410 })) as never);
    assert.deepEqual(await bad({ id: "1", kind: "k", title: "t", text: "x", imageUrl: "u", linkUrl: null }), { ok: false, status: 410 });
    const down = makeWebhookSender("https://hook.example/abc", undefined, (async () => { throw new Error("net"); }) as never);
    assert.deepEqual(await down({ id: "1", kind: "k", title: "t", text: "x", imageUrl: "u", linkUrl: null }), { ok: false, status: 0 });
  });

  await test("site: cards are JPEG (Instagram), noindex, public; cron + admin routes are exempt/guarded; the hub market names match", () => {
    assert.match(read("lib/social/render.tsx"), /\.jpeg\(/);
    assert.match(read("lib/social/render.tsx"), /x-robots-tag/);
    assert.ok(read("proxy.ts").includes("/api/private/social/cron/run") && read("vercel.json").includes("/api/private/social/cron/run"));
    assert.match(read("app/api/private/admin/social/route.ts"), /requireAdmin/);
    assert.match(read("app/api/private/social/cron/run/route.ts"), /isValidCronSecret/);
    assert.ok(marketBySlug("gold"));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}
main();
