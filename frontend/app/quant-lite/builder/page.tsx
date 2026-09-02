// app/quant-lite/builder/page.tsx
// Sprint Q0.8 - Strategy Builder (Screen 2). Server wrapper (Navbar/Footer,
// matching app/pricing's pattern) around the interactive client form.
import type { Metadata } from "next";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import StrategyBuilderForm from "./StrategyBuilderForm";

export const metadata: Metadata = {
  title: "Strategy Builder - Quant Lite",
  alternates: { canonical: "/quant-lite/builder" },
};

export default function StrategyBuilderPage() {
  return (
    <main className="min-h-screen bg-ink pt-20 text-text">
      <Navbar />
      <section className="mx-auto max-w-4xl px-6 py-12">
        <h1 className="text-2xl font-semibold text-text">Strategy Builder</h1>
        <p className="mt-1 text-sm text-text-3">
          Every field here maps to what the canonical Quant Lite engine actually supports - there are no
          hidden or unsupported options.
        </p>
        <div className="mt-8">
          <StrategyBuilderForm />
        </div>
      </section>
      <Footer />
    </main>
  );
}
