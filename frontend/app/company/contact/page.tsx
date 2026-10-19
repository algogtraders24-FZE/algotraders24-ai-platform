// app/company/contact/page.tsx
// Sprint D2.4.A1 - real, working contact channels sourced from the
// company's existing algotraders24.com site (WhatsApp, Telegram) rather
// than a fabricated email address or a form with no backend. No new
// infrastructure needed - each link opens the real, existing channel
// directly.
import type { Metadata } from "next";
import { MessageCircle, Send, Mail } from "lucide-react";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";
import { SOCIAL_PROFILES } from "@/config/social";

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
  {
    title: "Email",
    description: "contact@algotraders24.ai — for anything not urgent enough for chat.",
    href: "mailto:contact@algotraders24.ai",
    icon: Mail,
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
        <div className="mx-auto mt-10 max-w-xl text-center">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">Follow us</h2>
          <ul className="mt-4 flex flex-wrap justify-center gap-3">
            {SOCIAL_PROFILES.map((p) => (
              <li key={p.id}>
                <a
                  href={p.href}
                  target="_blank"
                  rel="me noopener noreferrer"
                  className="inline-flex flex-col rounded-control border border-border px-4 py-2 text-sm text-text-2 transition-colors hover:border-gold hover:text-gold"
                >
                  <span className="font-semibold">{p.label}</span>
                  <span className="text-xs text-text-3">{p.handle}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
        <p className="mx-auto mt-8 max-w-xl text-center text-xs text-text-3">Algotraders24 · Kingstown, Saint Vincent and the Grenadines</p>
      </section>

      <Footer />
    </main>
  );
}
