// SEO foundation: the meta description is one clean line, the listing structured data claims only what the system can back
// (no rating, no offer without a price and a real release), the JSON-LD is safe inside a script tag, and the regressions that
// were found in the audit stay fixed (global canonical, redirect URLs in the sitemap, indexable login pages).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { absoluteUrl, breadcrumbJsonLd, faqJsonLd, jsonLdString, metaDescription, productJsonLd, type ListingForSeo } from "../lib/seo/seo";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL - ${name}\n    ${(e as Error).message}`);
  }
}
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const SITE = "https://www.algotraders24.ai";

const listing = (over: Partial<ListingForSeo> = {}): ListingForSeo => ({
  slug: "at24-gold-range-breaker",
  title: "AT24 Gold Range Breaker",
  description: "Breakout EA for XAUUSD that trades the prior-day range.",
  sellerName: null,
  platformTag: "MT5",
  assetTag: "Gold",
  tags: ["breakout"],
  pricing: { model: "one_time", amount: 299, currency: "USD" },
  releaseId: "rel_1",
  media: ["/marketplace/x/icon.png", "https://cdn.example.com/hero.png"],
  updatedAt: "2026-10-14T00:00:00Z",
  ...over,
});

test("metaDescription: strips markdown, html and urls, collapses whitespace, never empty", () => {
  const d = metaDescription("## Gold EA\n\n**Trades** the <b>range</b> - see https://x.io/a and [docs](https://y.io) for more detail on how it works in practice.", "fallback text that is long enough to be a description on its own here");
  assert.ok(!/[#*<>\n]|https?:/.test(d), d);
  assert.ok(d.includes("Gold EA") && d.includes("docs"));
  assert.equal(metaDescription("", "Fallback description for an empty source that is long enough"), "Fallback description for an empty source that is long enough");
  assert.equal(metaDescription("short", "Fallback description for a too-short source that is long enough to use"), "Fallback description for a too-short source that is long enough to use");
});

test("metaDescription: cut at <=155 on a sentence or word boundary, with an ellipsis only when cut mid-sentence", () => {
  const long = "This expert advisor trades the previous day's high and low on gold with fixed risk per trade. It uses a volatility filter to skip quiet sessions and a daily loss cap. " + "More detail ".repeat(30);
  const d = metaDescription(long, "x".repeat(60));
  assert.ok(d.length <= 156, String(d.length));
  assert.ok(d.endsWith(".") || d.endsWith("…"), d);
  const noSentence = metaDescription("word ".repeat(80), "x".repeat(60));
  assert.ok(noSentence.length <= 156 && noSentence.endsWith("…"), noSentence);
});

test("absoluteUrl: relative paths get the site, absolute ones stay", () => {
  assert.equal(absoluteUrl("/marketplace/a", SITE), `${SITE}/marketplace/a`);
  assert.equal(absoluteUrl("https://cdn.x/y.png", SITE), "https://cdn.x/y.png");
  assert.equal(absoluteUrl("img.png", SITE), `${SITE}/img.png`);
});

test("productJsonLd: name/url/images/category; offer with price, currency and availability for a priced listing with a release", () => {
  const p = productJsonLd(listing(), SITE) as Record<string, any>;
  assert.equal(p["@type"], "Product");
  assert.equal(p.url, `${SITE}/marketplace/at24-gold-range-breaker`);
  assert.deepEqual(p.image, [`${SITE}/marketplace/x/icon.png`, "https://cdn.example.com/hero.png"]);
  assert.equal(p.category, "MT5 - Gold");
  assert.equal(p.brand.name, "Algotraders24 AI");
  assert.equal(p.offers.price, "299.00");
  assert.equal(p.offers.priceCurrency, "USD");
  assert.equal(p.offers.availability, "https://schema.org/InStock");
});

test("productJsonLd: NO offer without a price or without a real release; free listing is price 0; subscription carries its unit; never a rating", () => {
  assert.equal((productJsonLd(listing({ releaseId: null }), SITE) as any).offers, undefined);
  assert.equal((productJsonLd(listing({ pricing: { model: "unavailable" } }), SITE) as any).offers, undefined);
  assert.equal((productJsonLd(listing({ pricing: { model: "one_time" } }), SITE) as any).offers, undefined);
  assert.equal((productJsonLd(listing({ pricing: { model: "free" } }), SITE) as any).offers.price, "0.00");
  const sub = (productJsonLd(listing({ pricing: { model: "subscription", amount: 29, currency: "USD", interval: "month" } }), SITE) as any).offers;
  assert.equal(sub.priceSpecification.unitText, "MONTH");
  const all = JSON.stringify(productJsonLd(listing(), SITE));
  assert.ok(!/aggregateRating|review|ratingValue/i.test(all), "no fabricated rating or review");
});

test("productJsonLd: seller name becomes the brand when known", () => {
  assert.equal((productJsonLd(listing({ sellerName: "Acme Algos" }), SITE) as any).brand.name, "Acme Algos");
});

test("breadcrumb + FAQ JSON-LD shapes", () => {
  const b = breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Marketplace", path: "/marketplace" }], SITE) as any;
  assert.equal(b.itemListElement[1].position, 2);
  assert.equal(b.itemListElement[1].item, `${SITE}/marketplace`);
  const f = faqJsonLd([{ q: "Q1?", a: "A1." }]) as any;
  assert.equal(f["@type"], "FAQPage");
  assert.equal(f.mainEntity[0].acceptedAnswer.text, "A1.");
});

test("jsonLdString: '<' is escaped so a title can never close the script tag", () => {
  const s = jsonLdString({ name: "</script><script>alert(1)</script>" });
  assert.ok(!s.includes("</script>") && !s.includes("<"), s);
  assert.equal(JSON.parse(s).name, "</script><script>alert(1)</script>");
});

test("regression: the layout no longer sets a site-wide canonical or og:url; the homepage sets its own", () => {
  const layout = read("app/layout.tsx");
  assert.ok(!/canonical:\s*"\/"/.test(layout), "layout must not declare canonical '/'");
  assert.ok(!/url:\s*"\/",\s*\n\s*siteName/.test(layout), "layout must not declare og:url '/'");
  assert.match(read("app/page.tsx"), /canonical:\s*"\/"/);
});

test("regression: every marketplace listing page declares a self-referential canonical", () => {
  assert.match(read("app/marketplace/[slug]/page.tsx"), /canonical:\s*`\/marketplace\/\$\{listing\.slug\}`/);
  assert.match(read("app/marketplace/page.tsx"), /canonical:\s*"\/marketplace"/);
});

test("regression: the sitemap lists the real marketplace pages, not the redirecting /products URLs, and no account screens", () => {
  const sm = read("app/sitemap.ts");
  assert.ok(sm.includes("/marketplace/${l.slug}") && sm.includes("/marketplace`"));
  assert.ok(!/\$\{SITE_URL\}\/products/.test(sm), "no /products URLs");
  assert.ok(!/\$\{SITE_URL\}\/(login|signup)/.test(sm), "no login/signup URLs");
});

test("regression: auth screens are noindex; robots keeps private marketplace areas out", () => {
  assert.match(read("app/(auth)/layout.tsx"), /robots:\s*\{\s*index:\s*false/);
  const robots = read("app/robots.ts");
  assert.ok(robots.includes("/marketplace/my-products") && robots.includes("/marketplace/preview"));
});

test("regression: pricing and FAQ pages render their section heading as the page h1", () => {
  assert.match(read("app/pricing/page.tsx"), /<Pricing asPageHeading/);
  assert.match(read("app/resources/faq/page.tsx"), /<FAQ asPageHeading/);
  assert.match(read("sections/FAQ.tsx"), /asPageHeading \? "h1" : "h2"/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
