// scripts/validate-brief-render.ts
// Market Brief 2.0 phase 3: the public reader sanitizes/whitelists the structured sections and the page component renders them.
// Offline. Run: npx tsx scripts/validate-brief-render.ts
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc123.supabase.co";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildBriefFacts } from "../lib/publishing/brief/facts";
import { buildBriefSections } from "../lib/publishing/brief/templates";
import { toSafeSection, isAllowedImageUrl } from "../lib/publishing/brief/safe-section";
import { BriefSections, hasBriefSections } from "../components/publishing/BriefSections";
import type { ChartCandle } from "../types/chart-data";

let failures = 0;
const ok = (c: boolean, m: string) => { if (!c) { failures++; console.log("FAIL:", m); } };

const candles: ChartCandle[] = JSON.parse(readFileSync("scripts/fixtures/brief/BTCUSD_H1.json", "utf8"));
const facts = buildBriefFacts({ symbol: "BTCUSD", displayName: "Bitcoin", pair: "BTC/USD", category: "crypto", timeframeLabel: "H1", candles, macro: { alignmentPct: 35, label: "Mixed" } })!;
const good = "https://abc123.supabase.co/storage/v1/object/public/brief-charts/2026-11-22/btcusd-blog.png";
const built = buildBriefSections(facts, { chartUrl: good });

// createDraft rules (services/publishing/article.service.ts): every custom section body >= 40 chars, no placeholder markers
for (const s of built.sections) {
  ok(s.body.trim().length >= 40, `body >= 40 chars for ${s.kind} (${s.body.length})`);
  ok(!/lorem ipsum|\[insert|todo:|xxx|placeholder text/i.test(s.body), `no placeholder marker in ${s.kind}`);
}

// image host allow-list
ok(isAllowedImageUrl(good), "own supabase host allowed");
ok(isAllowedImageUrl("https://www.algotraders24.ai/brand/x.png"), "own site allowed");
ok(!isAllowedImageUrl("https://evil.example.com/a.png"), "foreign host rejected");
ok(!isAllowedImageUrl("http://abc123.supabase.co/a.png"), "http rejected");
ok(!isAllowedImageUrl("javascript:alert(1)"), "javascript: rejected");

// sanitization
const hostile = toSafeSection({
  heading: "<b>Head</b>", body: "x<script>alert(1)</script>y",
  kind: "evil" as never, bullets: ["<i>a</i>", "", "b"],
  chips: [{ value: "<u>1</u>", label: "l" }], cards: [{ title: "t", body: "b<script>", tone: "boom" as never }],
  image: { url: "https://evil.example.com/a.png", alt: "a", caption: "c" },
});
ok(hostile.kind === undefined, "unknown kind dropped");
ok(!JSON.stringify(hostile).includes("<script") && !JSON.stringify(hostile).includes("<b>"), "tags stripped");
ok(hostile.cards?.[0].tone === "neutral", "unknown tone becomes neutral");
ok(hostile.image === undefined, "foreign image dropped");
ok(hostile.bullets?.length === 2, "empty bullet dropped");

// round trip + render
const safe = built.sections.map((s) => toSafeSection(s));
ok(safe.every((s, i) => s.kind === built.sections[i].kind), "kinds survive the reader");
ok(safe.find((s) => s.kind === "hero")?.image?.url === good, "hero image survives");
ok(hasBriefSections(safe), "hasBriefSections true");
const html = renderToStaticMarkup(createElement(BriefSections, { sections: safe }));
ok(html.includes("<img") && html.includes("alt=\"BTC/USD H1 chart"), "hero img with alt rendered");
ok(html.includes("The technical picture, in plain words") && html.includes("Two scenarios"), "headings rendered");
ok(!html.includes("<script"), "no script in output");
ok((html.match(/<li/g) ?? []).length >= 8, "bullets and chips rendered as list items");

// old articles (no kind) keep the plain rendering path
const old = [{ heading: "Market Overview", body: "Old style body text that is long enough." }];
ok(!hasBriefSections(old), "old articles are not brief articles");
const oldHtml = renderToStaticMarkup(createElement(BriefSections, { sections: old }));
ok(oldHtml.includes("Market Overview") && oldHtml.includes("Old style body"), "fallback renders old sections");

console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
