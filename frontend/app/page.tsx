import Navbar from "@/components/layout/Navbar";
import Hero from "@/sections/Hero";
import TrustStrip from "@/sections/TrustStrip";
import PlatformOverview from "@/sections/PlatformOverview";
import WhyTraditionalTradingFails from "@/sections/WhyTraditionalTradingFails";
import ExplainableIntelligence from "@/sections/ExplainableIntelligence";
import InteractiveAnalysisDemo from "@/sections/InteractiveAnalysisDemo";
import AssistantPreview from "@/sections/AssistantPreview";
import PlatformModules from "@/sections/PlatformModules";
import EnterpriseTrust from "@/sections/EnterpriseTrust";
import Platforms from "@/sections/Platforms";
import FeaturedProducts from "@/sections/FeaturedProducts";
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
export default function Home() {
  return (
    <main id="main-content" className="min-h-screen bg-ink text-text">
      <Navbar />
      <Hero />
      <TrustStrip />
      <PlatformOverview />
      <WhyTraditionalTradingFails />
      <ExplainableIntelligence />
      <InteractiveAnalysisDemo />
      <AssistantPreview />
      <PlatformModules />
      <EnterpriseTrust />
      <Platforms />
      <FeaturedProducts />
      <CTA />
      <Footer />
    </main>
  );
}
