// app/resources/marketplace-seller-guide/page.tsx
// Sprint M12 branding follow-on - a real, accurate walkthrough of the
// actual seller flow (sell -> my-products -> submit), not aspirational
// copy. Every step, field, and gate named here matches real, shipped code
// as of this writing - if the flow changes, this page needs updating
// alongside it, same discipline as every other user-facing claim on this
// site.
import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";

export const metadata: Metadata = {
  title: "How to List a Product",
  description: "A real, accurate walkthrough of listing a trading system on the AT24 Marketplace - what each step does, and what AT24 verifies before anyone can buy.",
  alternates: { canonical: "/resources/marketplace-seller-guide" },
};

const STEPS = [
  {
    n: 1,
    title: "Create a draft listing",
    body: (
      <>
        Go to <Link href="/marketplace/sell" className="text-gold hover:underline">Sell on AT24</Link> and fill in
        title, description, platform (MT5/MT4/cTrader/NinjaTrader/Crypto/AI Engine), asset class, and category. This
        creates a <code className="text-text">DRAFT</code> listing - nothing is public yet, and nothing here is ever
        treated as a verified fact. If AT24 has already independently generated Evidence for a specific version of
        your system, you can link it under &quot;Advanced&quot; - otherwise leave it blank.
      </>
    ),
  },
  {
    n: 2,
    title: "Add branding in My Products",
    body: (
      <>
        Open <Link href="/marketplace/my-products" className="text-gold hover:underline">My Products</Link> (also in
        your dashboard sidebar once logged in). Upload:
        <ul className="mt-2 list-disc space-y-1 pl-5 text-text-2">
          <li><strong className="text-text">Icon / logo</strong> — exactly 200×200px (SVG, PNG, JPEG, or WebP). Enforced server-side; a different size is rejected with the exact dimensions it received.</li>
          <li><strong className="text-text">Banner / hero</strong> — a wide image for your listing&apos;s detail page.</li>
          <li><strong className="text-text">Screenshots</strong> — as many as you like: strategy tester results, chart setups, anything that helps a buyer understand the system.</li>
        </ul>
      </>
    ),
  },
  {
    n: 3,
    title: "Set a price",
    body: (
      <>
        Also in My Products: enter an amount and currency for a one-time purchase. This is the only place price is
        set — AT24 never sets or adjusts your price. A price alone doesn&apos;t make a listing purchasable (see step
        6).
      </>
    ),
  },
  {
    n: 4,
    title: "Preview before you submit",
    body: (
      <>
        Click &quot;Preview this listing&quot; from My Products to see exactly how buyers will see it — same page,
        same layout — before it&apos;s public. Only you can see this preview.
      </>
    ),
  },
  {
    n: 5,
    title: "Submit for review",
    body: (
      <>
        Click &quot;Submit for review.&quot; This runs a real ingestion pipeline (schema check, platform check,
        TradingSystem/Version binding, Evidence discovery) and then an eligibility check against AT24&apos;s own
        independently-computed Evidence, Validation, Risk Analysis, and Trust State for your system. You&apos;ll see
        the exact stage results and, if not yet eligible, the exact reasons — never a vague rejection.
      </>
    ),
  },
  {
    n: 6,
    title: "What AT24 actually verifies",
    body: (
      <>
        AT24-computed fields — Evidence, Validation, Risk Analysis, Trust State — are <strong className="text-text">never
        seller-writable</strong>, through any part of this flow. They come only from AT24 independently running your
        system&apos;s real backtest data through its own Evidence → Validation → Risk Analysis → Trust Status
        pipeline. A listing can reach <code className="text-text">READY</code>/<code className="text-text">PUBLISHED</code> with
        a Trust State that is honestly <code className="text-text">INCONCLUSIVE</code> — that&apos;s not a rejection,
        it means specific checks (e.g. market-regime coverage, parameter sensitivity) are still open. The real Trust
        State is always shown on your listing page exactly as computed, never softened.
      </>
    ),
  },
  {
    n: 7,
    title: "Purchasing turns on automatically",
    body: (
      <>
        A &quot;Buy Now&quot; button only ever appears once BOTH a valid price is set AND AT24 has registered a real,
        downloadable release build for your system&apos;s exact version and platform. Until then, buyers see an
        honest &quot;coming soon&quot; state — nobody can be charged for a listing with nothing real to deliver. Once
        both are true, checkout, payment, and a signed license (one active device per purchase, by default) all
        happen automatically.
      </>
    ),
  },
];

export default function MarketplaceSellerGuidePage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero
        eyebrow="Resources / Seller Guide"
        title="How to List a Product"
        subtitle="What each step actually does, and exactly what AT24 verifies before anyone can buy."
      />

      <section className="px-6 py-12">
        <div className="mx-auto max-w-3xl space-y-8">
          {STEPS.map((step) => (
            <div key={step.n} className="flex gap-4">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-gold/30 bg-gold/10 font-semibold text-gold">
                {step.n}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text">{step.title}</h2>
                <div className="mt-1.5 text-sm leading-6 text-text-2">{step.body}</div>
              </div>
            </div>
          ))}

          <div className="rounded-card border border-border bg-ink-2 p-6 text-center">
            <p className="text-sm text-text-2">Ready to start?</p>
            <Link
              href="/marketplace/sell"
              className="mt-3 inline-block rounded-control bg-gold px-6 py-3 font-semibold text-ink transition hover:brightness-110"
            >
              Create your first listing →
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
