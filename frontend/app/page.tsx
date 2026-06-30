import Navbar from "@/components/layout/Navbar";
import Hero from "@/sections/Hero";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#050816] text-white">
      <Navbar />
      <Hero />
    </main>
  );
}