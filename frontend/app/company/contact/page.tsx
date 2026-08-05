// app/company/contact/page.tsx
// Sprint D2.4.A1 - real, working contact channels sourced from the
// company's existing algotraders24.com site (WhatsApp, Telegram) rather
// than a fabricated email address or a form with no backend. No new
// infrastructure needed - each link opens the real, existing channel
// directly.
import type { Metadata } from "next";
import { MessageCircle, Send } from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with the Algotraders24 AI team.",
  alternates: { canonical: "/company/contact" },
};

const CHANNELS = [
  {
    title: "WhatsApp",
    description: "Message us directly for the fastest response.",
    href: "https://api.whatsapp.com/send?phone=971567355276",
    icon: MessageCircle,
  },
  {
    title: "Telegram",
    description: "Reach us on Telegram.",
    href: "https://t.me/algotraders24AI",
    icon: Send,
  },
];

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero eyebrow="Company / Contact" title="Get in touch" />

      <section className="px-6 py-12">
        <div className="mx-auto grid max-w-xl gap-4">
          {CHANNELS.map((channel) => (
            <a
              key={channel.title}
              href={channel.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-4 rounded-card border border-border bg-ink-2 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-gold hover:shadow-raised"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-gold/30 bg-gold/10">
                <channel.icon className="h-5 w-5 text-gold" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-lg font-semibold">{channel.title}</h2>
                <p className="mt-1 text-sm leading-6 text-text-2">{channel.description}</p>
              </div>
            </a>
          ))}
        </div>
        <p className="mx-auto mt-8 max-w-xl text-center text-xs text-text-3">Algotraders24 AI · Ajman Free Zone, UAE</p>
      </section>

      <Footer />
    </main>
  );
}
