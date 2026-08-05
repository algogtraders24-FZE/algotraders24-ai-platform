import Navbar from "@/components/layout/Navbar";
import Hero from "@/sections/Hero";
import TrustStrip from "@/sections/TrustStrip";
import PlatformOverview from "@/sections/PlatformOverview";
import ExplainableIntelligence from "@/sections/ExplainableIntelligence";
import LiveIntelligencePreview from "@/sections/LiveIntelligencePreview";
import InteractiveAnalysisDemo from "@/sections/InteractiveAnalysisDemo";
import AssistantPreview from "@/sections/AssistantPreview";
import PlatformModules from "@/sections/PlatformModules";
import DashboardShowcase from "@/sections/DashboardShowcase";
import WhyChoose from "@/sections/WhyChoose";
import Pricing from "@/sections/Pricing";
import EnterpriseTrust from "@/sections/EnterpriseTrust";
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
// closer. FAQ now shows only the top 5 of 7 items, linking to the full
// canonical list at /resources/faq (same source array, sliced - never a
// second, independently maintained copy). Deep-dive content that used to
// live only here (the 7-service technical trace, the full dashboard
// screenshot showcase) also now has a dedicated home under /platform/* -
// this page keeps a shorter version, not a duplicate of the full one.
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
      <InteractiveAnalysisDemo />
      <AssistantPreview />
      <DashboardShowcase />
      <WhyChoose />
      <EnterpriseTrust />
      <Pricing />
      <Platforms />
      <FAQ limit={5} />
      <CTA />
      <Footer />
    </main>
  );
}
