# SEO plan - Algotraders24 AI

Date: 2026-10-15. Method: a crawl of every URL in the sitemap plus every marketplace listing (72 URLs), comparing status, canonical,
description, og:image, h1 count and structured data, then reading the code behind each gap.

## 1. Audit result (before this work)
| # | Finding | Impact |
|---|---|---|
| 1 | The root layout set `canonical: "/"` for the whole site. Every page without its own canonical inherited it: **all 26 marketplace listing pages, /login, /signup** declared the homepage as their canonical (and og:url). | Listings (the money pages) were told to be copies of the homepage - effectively not indexable. |
| 2 | The sitemap listed `/products` and 10 `/products/<slug>` URLs, which 307-redirect to `/marketplace`; the real `/marketplace` and `/marketplace/<slug>` pages were not in the sitemap. | Crawlers were handed redirects; the real pages were only discoverable by following links. |
| 3 | Listing meta descriptions were empty or multi-line (descriptions are free text, sometimes with line breaks). | No snippet control in search results. |
| 4 | Listings only had Organization/WebSite structured data - no Product / Offer. | No price / product rich results. |
| 5 | Blog articles had no og:image (the article's `openGraph` replaced the layout's, dropping its image). /marketplace had none either. | Weak link previews on X, Telegram, WhatsApp, LinkedIn. |
| 6 | /pricing and /resources/faq had no h1 (the section heading was an h2). | Missing main heading on two key pages. |
| 7 | /login and /signup were indexable and in the sitemap, with the same title as the homepage. | Thin / duplicate pages competing with the homepage. |

What was already fine: HTTPS, www redirect (308 from the bare domain), robots.txt, a sensible sitemap generator, canonical + description + og
on the marketing pages, Article JSON-LD on blog posts, a daily auto-published blog (13 posts), /methodology and /calibration as trust pages.

## 2. Phase 0 - indexing foundation (shipped in this change)
1. No site-wide canonical / og:url; the homepage sets its own; every listing gets a self-referential canonical; /marketplace gets canonical + og image.
2. One clean meta description per listing (markdown / HTML / URLs stripped, cut at a sentence or word boundary, <= 155 chars, sensible fallback).
3. Sitemap = real pages only: /marketplace, every public listing (with `lastModified`), blog posts (with `lastModified`); no /products redirects, no account screens.
4. Structured data: Product (+ Offer only when there is a price AND a real downloadable release, subscription unit when applicable) and BreadcrumbList on
   listings and blog posts; FAQPage on /resources/faq with exactly the questions shown. **Never a rating or review** - the system has none.
5. Per-article OG image (title, category, date); h1 on /pricing and /resources/faq; login/signup noindex; robots keeps /marketplace/my-products and /marketplace/preview out.
6. Regression tests: `npm run validate:seo` (13) - including source-level guards for the global canonical, sitemap contents, auth noindex.

## 3. Phase 1 - content that can rank (next, in priority order)
1. **Market hub pages, `/markets/<symbol>`** (gold, silver, EUR/USD, GBP/USD, USD/JPY, Bitcoin, Ethereum): one public, server-rendered page per instrument that
   shows live, unique data the site already computes - today's expected range and key levels, regime, macro alignment, upcoming high-impact events, the
   calibration hit rate for that market, and links to the latest analyses and the relevant marketplace listings. Fresh data + internal links + a real
   answer to the search "XAUUSD expected range today". This is the strongest asset available because nobody else publishes a measured, self-checked range.
2. **Internal linking**: each blog analysis links to its market hub and to the matching listings (Gold EAs from a gold article); each listing links to its hub.
3. **Category landing pages** with real descriptions for the marketplace filters people search (MT5 gold EAs, MT4 EAs, TradingView indicators, cTrader bots,
   NinjaTrader bots) instead of query-string filters.
4. **Trust pages as link magnets**: /calibration (live scoreboard) and /methodology, plus the honest "what we tested and what did not work" write-up
   (SMC direction edge, COT) as an article - rare, citable, and consistent with the brand.
5. **Blog quality**: unique intros per post (the daily reports share a template), publish dates in the sitemap, an author/organisation byline, and a visible
   "how this was produced" link to /methodology (already added for E-E-A-T).

## 4. Phase 2 - measurement and distribution (owner actions marked)
1. **Google Search Console** (owner): add the property for `https://www.algotraders24.ai`, verify (send the verification tag - it goes into the root metadata
   in one line), submit `/sitemap.xml`, and check Pages > Indexing after ~1-2 weeks: marketplace listings should move from "Duplicate, Google chose different
   canonical" to "Indexed".
2. **Bing Webmaster Tools** (owner): import from Search Console; add **IndexNow** (a key file + a ping on every new blog post / listing; small code change, can be added on request).
3. Watch: indexed pages, impressions and clicks by page group (marketplace / blog / markets), Core Web Vitals (LCP of the marketplace and listing pages).
4. Social previews: check a listing and a blog article in the X / LinkedIn card validators after deploy.

## 5. Not doing (on purpose)
* No review / rating / "verified by N users" markup, no fake FAQ or HowTo schema, no keyword-stuffed text, no doorway pages, no purchased links.
* No claim in any title or description that is not on the page (Trust State words only when a listing really has one).
* Do not index account screens, previews or seller dashboards.

## 6. How to know it worked
Within 1-2 weeks of deploy and a sitemap resubmission: Search Console shows the 26 listings as indexed with their own canonical, the sitemap reports
~75 discovered URLs, and a site: search returns listing pages. Ranking for competitive head terms ("gold EA") is a months-long effort and is not promised here.
