// app/markets/[slug]/page.tsx
// Public market hub: live, measured context for one instrument (volatility range with its self-check, yesterday's high / low,
// macro drivers, upcoming releases, latest analyses, matching marketplace listings). Never a direction call. Server component;
// the heavy data is memoised for 10 minutes in services/markets/production.ts. Sections whose source is down are left out.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";
import { marketBySlug } from "@/services/markets/hub";
import { getMarketHub } from "@/services/markets/production";
import { breadcrumbJsonLd, jsonLdString } from "@/lib/seo/seo";
import { MIN_SAMPLE, TARGET_COVERAGE, type CalibrationRow } from "@/services/calibration/forecast";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const def = marketBySlug(slug);
  if (!def) return { title: "Market not found", robots: { index: false, follow: false } };
  const title = `${def.longName}: expected range, key levels and macro drivers`;
  const description = `Live ${def.name} context: how far it typically moves over the next 12 and 24 hours (checked against what happened), yesterday's high and low, macro drivers and upcoming high-impact events. No buy or sell calls.`;
  return {
    title,
    description,
    alternates: { canonical: `/markets/${def.slug}` },
    openGraph: { title, description, type: "website", url: `/markets/${def.slug}`, images: [{ url: "/og-image.png", width: 1200, height: 630, alt: `${def.longName} market context` }] },
    twitter: { card: "summary_large_image", title, description, images: ["/og-image.png"] },
  };
}

const pct = (v: number | null) => (v === null ? "-" : `${(v * 100).toFixed(0)}%`);

function CalibrationLine({ row, label }: { row: CalibrationRow | null; label: string }) {
  if (!row || row.n === 0) return <li className="text-text-2">{label}: collecting data (a verdict appears after {MIN_SAMPLE} checked forecasts).</li>;
  if (row.status === "collecting") return <li className="text-text-2">{label}: {row.n} checked so far, {pct(row.rate)} stayed inside - too few for a verdict (needs {MIN_SAMPLE}).</li>;
  return (
    <li className="text-text-2">
      {label}: <span className="font-mono text-text">{pct(row.rate)}</span> stayed inside over {row.n} checked forecasts (95% range {pct(row.lo)} - {pct(row.hi)}; target {TARGET_COVERAGE * 100}%).
    </li>
  );
}

export default async function MarketHubPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const def = marketBySlug(slug);
  if (!def) notFound();
  const v = await getMarketHub(def);
  const asOf = new Date(v.generatedAt).toLocaleString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <main className="min-h-screen bg-ink text-text">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdString(breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Markets", path: "/markets" }, { name: def.longName, path: `/markets/${def.slug}` }])) }}
      />
      <Navbar />
      <PageHero eyebrow="Live market context" title={`${def.longName}: range, levels and drivers`} subtitle="Measured, self-checked, and never a buy or sell call." />
      <section className="px-6 pb-16 pt-4">
        <div className="mx-auto max-w-4xl space-y-6">
          <p className="text-sm text-text-3">Data as of {asOf} UTC (refreshed about every 10 minutes). {def.symbol}.</p>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-panel border border-border bg-ink-2 p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-3">Price</p>
              <p className="mt-2 font-mono text-2xl text-text">{v.price ? v.price.text : "unavailable"}</p>
              {v.price && v.price.changePct !== null && (
                <p className={`mt-1 text-sm ${v.price.changePct >= 0 ? "text-success" : "text-danger"}`}>{v.price.changePct >= 0 ? "+" : ""}{v.price.changePct.toFixed(2)}% today</p>
              )}
            </div>
            <div className="rounded-panel border border-border bg-ink-2 p-5 sm:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-text-3">Expected range - about {TARGET_COVERAGE * 100}% of past moves stayed within</p>
              {v.ranges ? (
                <>
                  <p className="mt-2 font-mono text-lg text-text">{v.ranges.r12}</p>
                  <p className="font-mono text-lg text-text">{v.ranges.r24}</p>
                  {v.ranges.widenedNote && <p className="mt-2 text-sm text-gold">{v.ranges.widenedNote}</p>}
                  <p className="mt-2 text-xs text-text-3">A volatility range, not a direction or a target.</p>
                </>
              ) : (
                <p className="mt-2 text-text-2">Unavailable right now (not enough recent price data).</p>
              )}
            </div>
          </div>

          {(v.levels || v.structure) && (
            <div className="rounded-panel border border-border bg-ink-2 p-6">
              <h2 className="text-lg font-semibold text-text">Key levels and structure</h2>
              {v.levels && <p className="mt-2 leading-7 text-text-2">{v.levels}.</p>}
              {v.structure && (
                <p className="mt-2 leading-7 text-text-2">
                  Structure (descriptive only): 1h bias {v.structure.bias1h}, 4h bias {v.structure.bias4h}. Volatility: {v.structure.volatility}. Our back-tests found no reliable directional edge in this reading, so it
                  describes the market and does not predict it.
                </p>
              )}
            </div>
          )}

          {v.macro && (
            <div className="rounded-panel border border-border bg-ink-2 p-6">
              <h2 className="text-lg font-semibold text-text">Macro drivers</h2>
              <p className="mt-2 leading-7 text-text-2">
                Alignment: <span className="font-semibold text-text">{v.macro.label}</span>
                {v.macro.score !== null ? ` (${v.macro.score}% of driver weight points the same way)` : ""}. {v.macro.drivers}. A rule-based agreement of drivers, not a forecast.
              </p>
            </div>
          )}

          {v.events.length > 0 && (
            <div className="rounded-panel border border-border bg-ink-2 p-6">
              <h2 className="text-lg font-semibold text-text">Upcoming high-impact events</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {v.events.map((e) => (
                  <li key={`${e.utc}-${e.title}`} className="text-text-2">
                    <span className="font-mono text-text">{e.utc}</span> ({e.inText}) - {e.currency} {e.title}
                    {(e.forecast || e.previous) && <span className="text-text-3"> [{[e.forecast ? `forecast ${e.forecast}` : null, e.previous ? `previous ${e.previous}` : null].filter(Boolean).join(", ")}]</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-panel border border-border bg-ink-2 p-6">
            <h2 className="text-lg font-semibold text-text">What moves {def.name} in our reading</h2>
            <p className="mt-2 leading-7 text-text-2">{def.about}</p>
            <ul className="mt-3 space-y-1.5 text-sm text-text-2">
              {v.drivers.map((d) => (
                <li key={d.label}>
                  <span className="text-text">{d.label}</span> (weight {d.weight}): {d.rule}.
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-panel border border-border bg-ink-2 p-6">
            <h2 className="text-lg font-semibold text-text">Do these ranges hold up?</h2>
            <p className="mt-2 leading-7 text-text-2">Every few hours we record the range above and check it afterwards. The live result for {def.name}:</p>
            <ul className="mt-2 space-y-1 text-sm">
              <CalibrationLine row={v.calibration.row12} label="12-hour window" />
              <CalibrationLine row={v.calibration.row24} label="24-hour window" />
            </ul>
            <p className="mt-3 text-sm text-text-3">
              See every market on the <Link href="/calibration" className="text-gold hover:underline">calibration scoreboard</Link> and how this is built on the{" "}
              <Link href="/methodology" className="text-gold hover:underline">methodology</Link> page.
            </p>
          </div>

          {v.analyses.length > 0 && (
            <div className="rounded-panel border border-border bg-ink-2 p-6">
              <h2 className="text-lg font-semibold text-text">Latest {def.name} analyses</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {v.analyses.map((p) => (
                  <li key={p.slug}>
                    <Link href={`/blog/${p.slug}`} className="text-gold hover:underline">{p.title}</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {v.listings.length > 0 && (
            <div className="rounded-panel border border-border bg-ink-2 p-6">
              <h2 className="text-lg font-semibold text-text">Trading systems for {def.name}</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {v.listings.map((l) => (
                  <li key={l.slug}>
                    <Link href={`/marketplace/${l.slug}`} className="text-gold hover:underline">{l.title}</Link>
                    <span className="text-text-3"> - {l.platform}{l.price ? `, ${l.price}` : ""}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-text-3">
                Browse the <Link href="/marketplace" className="text-gold hover:underline">full marketplace</Link>. Every listing shows the evidence AT24 computed, never a seller-authored claim.
              </p>
            </div>
          )}

          <p className="text-sm text-text-3">
            Nothing here is financial advice or a recommendation to buy or sell. Read the <Link href="/company/disclaimer" className="text-gold hover:underline">disclaimer</Link>. All markets:{" "}
            <Link href="/markets" className="text-gold hover:underline">live market hubs</Link>.
          </p>
        </div>
      </section>
      <Footer />
    </main>
  );
}
