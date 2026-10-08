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
  description: "Sell your trading product on the AT24 Marketplace: upload a file, add a logo and a price, publish - and optionally show real results from a demo or live account.",
  alternates: { canonical: "/resources/marketplace-seller-guide" },
};

const STEPS = [
  {
    n: 1,
    title: "Upload your product",
    body: (
      <>
        Go to <Link href="/marketplace/sell" className="text-gold hover:underline">Sell your product</Link> and choose your
        file: <code className="text-text">.ex5</code>, <code className="text-text">.ex4</code>, or a <code className="text-text">.zip</code> with
        several files (also .mq5 .mq4 .pine .cs .py .set .tpl .pdf), up to 50 MB. Programs and scripts (.dll, .exe, .bat,
        .ps1, .js ...) are not accepted, not even inside a zip. Your file is stored privately and is only ever given to
        people who bought it.
      </>
    ),
  },
  {
    n: 2,
    title: "Add logo, banner, description and price",
    body: (
      <>
        A logo (exactly 200x200 px), an optional wide banner, a description (at least 40 characters) and a one-time price in
        USD. Your description is shown as your own claim - AT24 never presents it as verified.
      </>
    ),
  },
  {
    n: 3,
    title: "Publish - it goes live immediately",
    body: (
      <>
        Press Publish. There is no waiting for an admin. The listing appears in the marketplace with the label{" "}
        <strong className="text-text">Not checked</strong>, and the Buy button works as soon as your file is stored.
        &quot;Not checked&quot; is not a negative signal: it only means AT24 has not run its own verification on the product.
      </>
    ),
  },
  {
    n: 4,
    title: "Optional: show real results",
    body: (
      <>
        Sellers who want buyers to see real, ongoing performance attach their <strong className="text-text">demo or live
        account</strong>: install the free AT24 Live Sync EA, open{" "}
        <Link href="/dashboard/live-results" className="text-gold hover:underline">Live Results</Link>, make a results page public and link
        it to your listing. A &quot;Live results of this EA&quot; card then appears on your listing, clearly marked DEMO or
        REAL and as reported by your own terminal.
      </>
    ),
  },
  {
    n: 5,
    title: "Optional: an AT24 check from a backtest report",
    body: (
      <>
        Attach the MetaTrader 5 Strategy Tester report (Save as Report: Excel .xlsx or HTML, with the Deals section, up to
        50 MB) in the same form. After you publish, AT24 reads it automatically, re-adds every trade in its deals list and
        compares the result with the summary printed in the report. If the numbers agree, your page gets a box{" "}
        <strong className="text-text">Checked from the seller&apos;s report</strong> with the key figures. This confirms the
        report is internally consistent; it does not prove the test ran on real market data, so it is never shown as the
        independent <em>Validated</em> badge. No report, or one we cannot read? The listing simply stays{" "}
        <strong className="text-text">Not checked</strong> and you can sell it right away.
      </>
    ),
  },
  {
    n: 6,
    title: "Optional: protect your product with the AT24 licence key",
    body: (
      <>
        Every purchase gets <strong className="text-text">one licence key</strong> (shown on the buyer&apos;s purchase page). To make your EA
        require it, download{" "}
        <a href="/downloads/AT24_License.mqh" className="text-gold hover:underline">AT24_License.mqh</a>, put it next to your source and add an{" "}
        <code className="text-text">input string InpLicenseKey</code>. In <code className="text-text">OnInit</code> call{" "}
        <code className="text-text">AT24_CheckLicense(InpLicenseKey, result)</code>: it sends only the key and the trading account number to AT24
        and tells you <code className="text-text">valid</code>, the <code className="text-text">buyerId</code> and the expiry. By default the key is tied to the
        first trading account that uses it (the same account keeps working). Your buyers allow
        <code className="text-text"> https://www.algotraders24.ai</code> once under Tools → Options → Expert Advisors → WebRequest. Works for MT4 and MT5.
        Other platforms can call <code className="text-text">POST /api/license/check</code> with <code className="text-text">{`{"key":"..."}`}</code> directly.
      </>
    ),
  },
  {
    n: 7,
    title: "Payments",
    body: (
      <>
        Buyers pay through the marketplace checkout and receive a signed licence automatically. Seller payouts are not live
        yet: sales are recorded, and will be paid out after payouts launch, minus the platform commission (currently planned
        at 10%). Listings can be removed at any time if they break the rules or buyers report a problem.
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
        subtitle="Upload, add a logo and a price, publish. Real results from a demo or live account are optional."
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
