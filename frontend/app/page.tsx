import Navbar from "@/components/layout/Navbar";
import MarketRibbon from "@/sections/MarketRibbon";
import Hero from "@/sections/Hero";
import Platforms from "@/sections/Platforms";
import Markets from "@/sections/Markets";
import FeaturedProducts from "@/sections/FeaturedProducts";
import Technology from "@/sections/Technology";
import Stats from "@/sections/Stats";
import Testimonials from "@/sections/Testimonials";
import CTA from "@/sections/CTA";
import Footer from "@/sections/Footer";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#050816] text-white">
      <Navbar />
      <MarketRibbon />
      <Hero />
      <Platforms />
      <Markets />
      <FeaturedProducts />
      <Technology />
      <Stats />
      <Testimonials />
      <CTA />
      <Footer />
    </main>
  );
}