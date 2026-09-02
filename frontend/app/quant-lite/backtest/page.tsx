// app/quant-lite/backtest/page.tsx
// Sprint Q0.8 - Backtest Setup (Screen 3) wrapper.
import type { Metadata } from "next";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import BacktestSetupForm from "./BacktestSetupForm";

export const metadata: Metadata = {
  title: "Backtest Setup - Quant Lite",
  alternates: { canonical: "/quant-lite/backtest" },
};

export default function BacktestSetupPage() {
  return (
    <main className="min-h-screen bg-ink pt-20 text-text">
      <Navbar />
      <section className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-2xl font-semibold text-text">Backtest Setup</h1>
        <p className="mt-1 text-sm text-text-3">Confirm the details below, then run your backtest.</p>
        <div className="mt-8">
          <BacktestSetupForm />
        </div>
      </section>
      <Footer />
    </main>
  );
}
