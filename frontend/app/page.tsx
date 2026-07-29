import Navbar from "@/components/layout/Navbar";
import Hero from "@/sections/Hero";
import PlatformOverview from "@/sections/PlatformOverview";
import WhyTraditionalTradingFails from "@/sections/WhyTraditionalTradingFails";
import ExplainableIntelligence from "@/sections/ExplainableIntelligence";
import AssistantPreview from "@/sections/AssistantPreview";
import Platforms from "@/sections/Platforms";
import FeaturedProducts from "@/sections/FeaturedProducts";
import CTA from "@/sections/CTA";
import Footer from "@/sections/Footer";

// Sprint H1.4 - MarketRibbon, Markets, Technology, Stats, and Testimonials
// are retired entirely (Phase 1: fabricated ticker data, fake metrics, and
// invented testimonials - deleted, not hidden or patched). Platforms,
// FeaturedProducts, and CTA are untouched this sprint (real, DB-backed, or
// out of this sprint's explicit scope) - see the H1.4 report for what's
// planned next.
export default function Home() {
  return (
    <main id="main-content" className="min-h-screen bg-ink text-text">
      <Navbar />
      <Hero />
      <PlatformOverview />
      <WhyTraditionalTradingFails />
      <ExplainableIntelligence />
      <AssistantPreview />
      <Platforms />
      <FeaturedProducts />
      <CTA />
      <Footer />
    </main>
  );
}
