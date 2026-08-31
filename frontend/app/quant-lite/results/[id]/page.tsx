// app/quant-lite/results/[id]/page.tsx
// Sprint Q0.8 - Results page (Screen 5) wrapper. Async `params` per this
// app's Next.js 16 convention (see app/products/[slug]/page.tsx).
import type { Metadata } from "next";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import ResultsView from "./ResultsView";

export const metadata: Metadata = {
  title: "Backtest Results - Quant Lite",
};

export default async function BacktestResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="min-h-screen bg-ink pt-20 text-text">
      <Navbar />
      <section className="mx-auto max-w-5xl px-6 py-12">
        <ResultsView backtestId={id} />
      </section>
      <Footer />
    </main>
  );
}
