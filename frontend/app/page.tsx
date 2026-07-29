import Navbar from "@/components/layout/Navbar";
import Hero from "@/sections/Hero";
import TrustStrip from "@/sections/TrustStrip";
import PlatformOverview from "@/sections/PlatformOverview";
import WhyTraditionalTradingFails from "@/sections/WhyTraditionalTradingFails";
import ExplainableIntelligence from "@/sections/ExplainableIntelligence";
import ArchitectureVisualization from "@/sections/ArchitectureVisualization";
import AssistantPreview from "@/sections/AssistantPreview";
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
export default function Home() {
  return (
    <main id="main-content" className="min-h-screen bg-ink text-text">
      <Navbar />
      <Hero />
      <TrustStrip />
      <PlatformOverview />
      <WhyTraditionalTradingFails />
      <ExplainableIntelligence />
      <ArchitectureVisualization />
      <AssistantPreview />
      <Platforms />
      <FeaturedProducts />
      <CTA />
      <Footer />
    </main>
  );
}
