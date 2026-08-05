import Navbar from "@/components/layout/Navbar";
import Hero from "@/sections/Hero";
import TrustStrip from "@/sections/TrustStrip";
import PlatformOverview from "@/sections/PlatformOverview";
import FeaturedProducts from "@/sections/FeaturedProducts";
import PricingTeaser from "@/sections/PricingTeaser";
import FAQ from "@/sections/FAQ";
import CTA from "@/sections/CTA";
import Footer from "@/sections/Footer";

// Sprint H1.4 - MarketRibbon, Markets, Technology, Stats, and Testimonials
// are retired entirely (Phase 1: fabricated ticker data, fake metrics, and
// invented testimonials - deleted, not hidden or patched).
// Sprint H1.5 - Trust Strip added after Hero (real platform principles, no
// borrowed-trust logos).
//
// Sprint D2.4.A1/A2 - the site's dedicated pages (/platform/*, /pricing,
// /resources/faq, /company/*, /solutions/*) were built out, then the
// homepage was compressed to lean on them instead of repeating their depth.
//
// Sprint D2.4.A3 - Homepage Optimization: the final target structure is
// exactly seven sections - Hero, TrustStrip, PlatformOverview, Products,
// Pricing, FAQ, CTA - so a first-time visitor understands "AI Trading
// Intelligence Platform" on screen one, the six core capabilities by screen
// two, and can reach Start Free or Products within 2-3 scrolls. Everything
// that used to live here and explained a capability in depth (Explainable
// Intelligence, the Live Intelligence Preview snapshot, the Interactive
// Analysis Demo, the Dashboard screenshot showcase, the Why Choose
// comparison, the separate 8-module chip strip) is removed from the
// homepage, not deleted from the site: it's real, unabridged content on
// /platform/market-intelligence, /platform/workspace, /company/vision, and
// the /platform hub, each one reachable from a "Learn More" link here.
// ExplainableIntelligence.tsx, LiveIntelligencePreview.tsx, and
// DashboardShowcase.tsx are deleted as dead files (their only consumer was
// this page, and their content already lives in full on those pages).
// WhyChoose.tsx is kept - /company/vision imports it directly - just no
// longer rendered here.
//
// PlatformOverview now does the combined job the old 4-card PlatformOverview
// and 8-chip PlatformModules used to split across two sections - one curated
// 6-card grid (PlatformModules.tsx is deleted, its full 8-module breadth
// still lives on the /platform hub). Pricing is PricingTeaser (real
// 4-tier data, compact chips) rather than the full <Pricing /> grid, which
// stays unchanged at /pricing. FAQ shows the top 5 of 7; the rest is at
// /resources/faq.
export default function Home() {
  return (
    <main id="main-content" className="min-h-screen bg-ink text-text">
      <Navbar />
      <Hero />
      <TrustStrip />
      <PlatformOverview />
      <FeaturedProducts />
      <PricingTeaser />
      <FAQ limit={5} />
      <CTA />
      <Footer />
    </main>
  );
}
