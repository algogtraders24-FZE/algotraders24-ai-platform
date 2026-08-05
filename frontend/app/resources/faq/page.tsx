// app/resources/faq/page.tsx
// Sprint D2.4.A1 - the canonical, full FAQ. Renders the exact same
// sections/FAQ.tsx used (in a sliced, top-5 form) on the homepage, so there
// is exactly one source of truth for these answers, never two independently
// maintained copies.
import type { Metadata } from "next";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import FAQ from "@/sections/FAQ";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Questions, answered plainly — the same honesty the platform applies to every analysis.",
  alternates: { canonical: "/resources/faq" },
};

export default function FaqPage() {
  return (
    <main className="min-h-screen bg-ink pt-20 text-text">
      <Navbar />
      <FAQ />
      <Footer />
    </main>
  );
}
