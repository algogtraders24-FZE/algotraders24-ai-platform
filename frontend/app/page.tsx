import Navbar from "@/components/layout/Navbar";
import Hero from "@/sections/Hero";
import TrustStrip from "@/sections/TrustStrip";
import PlatformOverview from "@/sections/PlatformOverview";
import ExplainableIntelligence from "@/sections/ExplainableIntelligence";
import LiveIntelligencePreview from "@/sections/LiveIntelligencePreview";
import PlatformModules from "@/sections/PlatformModules";
import DashboardShowcase from "@/sections/DashboardShowcase";
import WhyChoose from "@/sections/WhyChoose";
import PricingTeaser from "@/sections/PricingTeaser";
import Platforms from "@/sections/Platforms";
import FeaturedProducts from "@/sections/FeaturedProducts";
import FAQ from "@/sections/FAQ";
import CTA from "@/sections/CTA";
import Footer from "@/sections/Footer";

// Sprint H1.4 - MarketRibbon, Markets, Technology, Stats, and Testimonials
// are retired entirely (Phase 1: fabricated ticker data, fake metrics, and
// invented testimonials - deleted, not hidden or patched).
// Sprint H1.5 - Trust Strip added after Hero (real platform principles, no
// borrowed-trust logos); Architecture Visualization added after Explainable
// Intelligence as the page's second, more technical pipeline trace;
// Platforms, FeaturedProducts, and CTA rebuilt onto the token system with
// honest, repositioned copy and no broken image references.
// Sprint H1.7 - Interactive Analysis Demo added (a hands-on, clearly-
// illustrative preview of the real output shape wired to production in
// Sprint L2.1); Enterprise Trust added after Assistant Preview, right
// before the commercial sections, earning institutional confidence through
// verifiable architecture rather than fabricated client claims.
// Sprint D2.1 (Phase 5) - the standalone ArchitectureVisualization section
// was retired: the same deterministic pipeline was being explained three
// times back-to-back. Its seven-service technical trace now lives as an
// on-demand disclosure inside ExplainableIntelligence, so the main scroll
// explains the flow once (ExplainableIntelligence) and proves it once,
// interactively (InteractiveAnalysisDemo).
//
// Sprint D2.4.A1 - resequenced to the approved IA flow: Platform (Overview +
// Modules) -> Products -> AI Intelligence (Explainable Intelligence + the
// new Live Intelligence Preview + the interactive demo) -> Pricing, with
// Hero/TrustStrip as the opener and WhyChoose/EnterpriseTrust/FAQ/CTA as the
// closer.
//
// Sprint D2.4.A2 - Homepage Compression & Conversion Optimization. Target:
// a first-time visitor understands "AI Trading Intelligence Platform" on
// screen one (Hero), the core capabilities by screen two (TrustStrip +
// compact PlatformOverview), and can reach Start Free or Products within
// 2-3 scrolls - everything past that is optional depth, not required
// reading. Every section below was shortened, not deleted: the full detail
// each one used to carry now lives on a real dedicated page, one click away
// via that section's "Learn More" link.
//   - PlatformOverview: click-to-expand detail text removed (kept verbatim
//     or exceeded in depth on each /platform/* leaf page).
//   - PlatformModules: per-card descriptions removed (full descriptions now
//     on the enriched /platform hub, all nine modules).
//   - ExplainableIntelligence: animated 5-card reveal + tech-trace
//     collapsible replaced with a static 5-label strip (full depth now on
//     /platform/market-intelligence).
//   - InteractiveAnalysisDemo removed entirely - it's now really embedded on
//     /platform/market-intelligence instead of just being described there.
//   - AssistantPreview removed entirely - its sample conversation is
//     verbatim on /platform/assistant, which also gained the real
//     assistant.png screenshot this section's sibling, DashboardShowcase,
//     used to show.
//   - DashboardShowcase: down to one screenshot + one line (full callout
//     list + both screenshots preserved across /platform/workspace and
//     /platform/assistant).
//   - WhyChoose: compact (top 3 of 6 each side); full 6-and-6 comparison now
//     embedded on /company/vision.
//   - EnterpriseTrust removed entirely - already verbatim on
//     /company/vision since D2.4.A1; dead file deleted.
//   - Pricing replaced with PricingTeaser (compact, same real config data);
//     full tier/feature breakdown unchanged at /pricing.
//   - Platforms: compact chip strip; full descriptive grid now also on
//     /products.
//   - FeaturedProducts: 6 cards -> 3; full catalogue at /products.
//   - FAQ: 5 -> 3; full 7 unchanged at /resources/faq.
export default function Home() {
  return (
    <main id="main-content" className="min-h-screen bg-ink text-text">
      <Navbar />
      <Hero />
      <TrustStrip />
      <PlatformOverview />
      <PlatformModules />
      <FeaturedProducts />
      <ExplainableIntelligence />
      <LiveIntelligencePreview />
      <DashboardShowcase />
      <WhyChoose compact />
      <PricingTeaser />
      <Platforms compact />
      <FAQ limit={3} />
      <CTA />
      <Footer />
    </main>
  );
}
