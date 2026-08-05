// app/pricing/page.tsx
// Sprint D2.4.A1 - dedicated pricing route. Renders the exact same
// sections/Pricing.tsx used on the homepage (DB-backed via
// config/billing.config.ts + config/plan-limits.ts) so the two surfaces can
// never drift into two different price lists.
import type { Metadata } from "next";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import Pricing from "@/sections/Pricing";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Simple, transparent pricing — start free and upgrade when you're ready. Every plan runs on the same explainable engine.",
  alternates: { canonical: "/pricing" },
};

// Sprint D2.4.A1 - Pricing.tsx already renders its own complete "Pricing /
// Simple, transparent pricing" header (eyebrow + h2 + subtitle), so this
// page does not also add a PageHero - that would duplicate the heading.
// FAQ is deliberately NOT embedded here too: /resources/faq is the one
// canonical destination for the FAQ content, avoiding the same 7 items
// rendered as duplicate content on two separate indexed pages.
export default function PricingPage() {
  return (
    <main className="min-h-screen bg-ink pt-20 text-text">
      <Navbar />
      <Pricing />
      <Footer />
    </main>
  );
}
