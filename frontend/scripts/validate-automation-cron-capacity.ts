// scripts/validate-automation-cron-capacity.ts
// Regression for the 2026-10-13 morning cron: runs were dispatched one after
// another inside a 60s function, so only ~2 fit and the rest were killed mid-way
// (their child agent later timed out). Plus the publication-draft slug collision
// that failed the second Gold Morning run. Pure/in-memory.
// `npm run validate:automation-cron-capacity`.

import assert from "node:assert/strict";
import { runWithConcurrency } from "../services/automation/concurrency";
import { buildSeo, withSlugSuffix } from "../services/ai/publishing/seo.service";
import { istDateKey } from "../services/automation/brief-extras";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  console.log("validate-automation-cron-capacity\n");

  await test("runs overlap: 10 jobs x 50ms at limit 5 finish in ~2 waves, not 10 in a row", async () => {
    const t0 = Date.now();
    await runWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 5, () => sleep(50));
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 250, `took ${elapsed}ms - jobs ran sequentially`);
  });

  await test("never more than `limit` in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    await runWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 3, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await sleep(10);
      inFlight -= 1;
    });
    assert.equal(peak, 3);
  });

  await test("every item is processed exactly once", async () => {
    const seen: number[] = [];
    const n = await runWithConcurrency([1, 2, 3, 4, 5, 6, 7], 4, async (x) => void seen.push(x));
    assert.equal(n, 7);
    assert.deepEqual([...seen].sort(), [1, 2, 3, 4, 5, 6, 7]);
  });

  await test("shouldStop() stops STARTING new items (in-flight ones finish)", async () => {
    let stop = false;
    const done: number[] = [];
    const n = await runWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (x) => {
      await sleep(20);
      done.push(x);
      if (x >= 2) stop = true;
    }, () => stop);
    assert.ok(n < 6, `started ${n}`);
    assert.ok(done.length === n);
  });

  await test("empty input and limit <= 0 are safe", async () => {
    assert.equal(await runWithConcurrency([], 5, async () => {}), 0);
    assert.equal(await runWithConcurrency([1, 2], 0, async () => {}), 2);
  });

  // ── draft slug ──
  await test("same title -> same slug (the collision); a per-run suffix makes it unique", () => {
    const a = buildSeo("Gold Market Analysis", ["market", "analysis"]);
    const b = buildSeo("Gold Market Analysis", ["market", "analysis"]);
    assert.equal(a.slug, b.slug);
    const s1 = withSlugSuffix(a, "2026-10-13-abc123");
    const s2 = withSlugSuffix(b, "2026-10-13-def456");
    assert.notEqual(s1.slug, s2.slug);
    assert.equal(s1.slug, "gold-market-analysis-2026-10-13-abc123");
  });

  await test("suffix keeps canonical URL / OpenGraph in step with the slug; empty suffix changes nothing", () => {
    const a = buildSeo("Gold Market Analysis", ["x"]);
    const s = withSlugSuffix(a, "2026-10-13-abc123");
    assert.equal(s.canonicalUrl, `https://algotraders24.ai/blog/${s.slug}`);
    assert.equal(s.openGraph.url, s.canonicalUrl);
    assert.equal(s.title, a.title);
    assert.deepEqual(withSlugSuffix(a, ""), a);
    assert.deepEqual(withSlugSuffix(a, "  !! "), a);
  });

  await test("suffix is slug-safe", () => {
    const s = withSlugSuffix(buildSeo("T", []), "A b/C_d");
    assert.match(s.slug, /^t-a-b-c-d$/);
  });

  await test("IST date key for the suffix", () => {
    assert.equal(istDateKey(new Date("2026-10-12T20:00:00Z")), "2026-10-13");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
