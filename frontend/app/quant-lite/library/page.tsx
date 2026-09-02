// app/quant-lite/library/page.tsx
// Sprint Q0.8 - Strategy Library (Screen 6). Server component - the
// sample data is static (read-only from strategy_library.db, never
// modified, per Q0.7/Q0.8's explicit instruction), so no client fetch is
// needed for the initial render; filtering happens client-side.
import type { Metadata } from "next";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import ButtonLink from "@/components/ui/ButtonLink";
import LibraryBrowser from "./LibraryBrowser";
import { LIBRARY_SAMPLE } from "@/data/quant-lite-library-sample";

export const metadata: Metadata = {
  title: "Strategy Library - Quant Lite",
  alternates: { canonical: "/quant-lite/library" },
};

export default function StrategyLibraryPage() {
  return (
    <main className="min-h-screen bg-ink pt-20 text-text">
      <Navbar />
      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-text">Strategy Library</h1>
            <p className="mt-1 max-w-2xl text-sm text-text-3">
              This is a fixed, pre-existing set of results from a prior engine version - research evidence, not
              validated performance, and not the same thing as a backtest you run yourself. Filtering narrows
              which results are shown - it does not validate them.
            </p>
          </div>
          {/* Q1.6 Part 11 - "Your Backtests" as a persisted, per-account list
              does not exist (no auth is wired to Quant Lite jobs - see
              Q1.6_UI_EXISTING_STATE.md Part 16); this CTA gives the real,
              honest distinction ("this library is fixed and legacy; running
              your own strategy is a click away") without inventing a
              history feature that isn't there. */}
          <ButtonLink href="/quant-lite/builder" variant="secondary">
            Run your own backtest instead →
          </ButtonLink>
        </div>
        <div className="mt-8">
          <LibraryBrowser entries={LIBRARY_SAMPLE} />
        </div>
      </section>
      <Footer />
    </main>
  );
}
