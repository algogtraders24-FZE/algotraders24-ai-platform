// app/company/page.tsx
// Sprint D2.4.A1 - the Company nav dropdown's landing page.
import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Compass, Mail, ShieldAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";

export const metadata: Metadata = {
  title: "Company",
  description: "About Algotraders24 AI, our vision, and how to reach us.",
  alternates: { canonical: "/company" },
};

const LINKS: { title: string; description: string; href: string; icon: LucideIcon }[] = [
  { title: "About", description: "Who we are and what the platform does.", href: "/company/about", icon: Building2 },
  { title: "Vision", description: "Why we're building this, and where it's going.", href: "/company/vision", icon: Compass },
  { title: "Contact", description: "Real, working ways to reach us.", href: "/company/contact", icon: Mail },
  { title: "Disclaimer", description: "The risk and AI-output disclosures that apply platform-wide.", href: "/company/disclaimer", icon: ShieldAlert },
];

export default function CompanyHubPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero eyebrow="Company" title="About Algotraders24 AI" />
      <section className="px-6 py-12">
        <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-2">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="group flex items-start gap-4 rounded-card border border-border bg-ink-2 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-gold hover:shadow-raised"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-gold/30 bg-gold/10">
                <link.icon className="h-5 w-5 text-gold" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-lg font-semibold">{link.title}</h2>
                <p className="mt-1 text-sm leading-6 text-text-2">{link.description}</p>
              </div>
            </Link>
          ))}
        </div>
        <p className="mx-auto mt-8 max-w-4xl text-center text-xs text-text-3">
          Legal pages (Privacy Policy, Terms, Cookie Policy) are being finalized and will be published once ready.
        </p>
      </section>
      <Footer />
    </main>
  );
}
