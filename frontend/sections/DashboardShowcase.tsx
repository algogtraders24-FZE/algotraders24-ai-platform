// sections/DashboardShowcase.tsx
// Sprint D2.1 (Phase 11) - the real product, not a mockup. Every image in
// public/showcase/ is a genuine screenshot captured from an authenticated
// session against the live app (the Market Intelligence shot is a real
// EUR/USD run through the deterministic pipeline - note it honestly reports
// HIGH risk / LOW confidence because most evidence types were unavailable,
// exactly as the platform is designed to). Screenshots are unedited except
// for cropping out the account holder's name/email; no data is fabricated or
// retouched.
//
// Sprint D2.4.A2 - homepage compression. This used to show both real
// screenshots (Market Intelligence + AI Assistant) plus a 4-item callout
// list; now it's a single compact frame + one line, linking to
// /platform/workspace which carries the full callout list. The dropped
// assistant.png screenshot moved to /platform/assistant instead - a better
// thematic fit, and nothing was deleted, just relocated.
import Image from "next/image";
import Link from "next/link";

export default function DashboardShowcase() {
  return (
    <section className="relative overflow-hidden bg-ink-2 py-16 text-text md:py-24">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-32 left-1/2 h-[26rem] w-[42rem] -translate-x-1/2 rounded-full bg-gold/5 blur-3xl"
      />
      <div className="relative mx-auto max-w-4xl px-6 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">Dashboard</p>
        <h2 className="mt-4 font-display text-4xl font-medium md:text-5xl">See the real platform, not a mockup</h2>
        <p className="mt-5 text-lg text-text-2">A real EUR/USD run — nothing staged, nothing retouched.</p>

        <div className="mt-10 overflow-hidden rounded-panel border border-border bg-ink shadow-raised">
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <span className="text-xs font-medium text-text-2">Market Intelligence — Explainable Analysis</span>
            <span className="ml-auto rounded-control border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold">
              Live screenshot
            </span>
          </div>
          <Image
            src="/showcase/market-intelligence.png"
            alt="A real EUR/USD analysis: overall risk High, confidence Low (20/100), with supporting evidence and an eight-category risk breakdown."
            width={1440}
            height={1010}
            className="h-auto w-full"
            sizes="(max-width: 1024px) 100vw, 60vw"
          />
        </div>

        <div className="mt-8">
          <Link href="/platform/workspace" className="text-sm font-semibold text-gold transition-colors hover:text-gold-strong">
            See the full workspace →
          </Link>
        </div>
      </div>
    </section>
  );
}
