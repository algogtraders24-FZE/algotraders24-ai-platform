import Navbar from "@/components/layout/Navbar";
import MarketRibbon from "@/sections/MarketRibbon";
import Hero from "@/sections/Hero";
import Platforms from "@/sections/Platforms";
import Markets from "@/sections/Markets";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#050816] text-white">
      <Navbar />
      <MarketRibbon />
      <Hero />
      <Platforms />
      <Markets />
    </main>
  );
}