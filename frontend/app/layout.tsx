import type { Metadata } from "next";
import { Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

// Sprint H1.3 - Activates the fonts globals.css already referenced but
// never loaded (--font-geist-sans/--font-geist-mono were dead variables,
// silently falling back to a hardcoded Arial override in globals.css).
// Source_Serif_4 is new: the approved display face (H1.2A), reserved for
// H1 headlines only - see the type hierarchy rule in the design system.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

const displaySerif = Source_Serif_4({
  variable: "--font-serif-display",
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
});

// Sprint H1.3 - Replaces the legacy "Expert Advisors, indicators and bots"
// positioning with the approved AI Trading Intelligence Platform messaging
// (Sprint H1.2A Brand Messaging Bible).
// Sprint H1.6 - completes launch metadata: canonical URL, Open Graph,
// Twitter Card, and robots. SITE_URL matches the real domain already used
// elsewhere in this codebase (services/ai/publishing/seo.service.ts,
// prisma/seed.ts demo accounts), not invented for this sprint. No OG/Twitter
// image is set - there's no real, designed social-preview asset in
// public/ yet, and fabricating one would violate the no-invented-content
// rule; a real 1200x630 image is a follow-up design task, flagged in the
// H1.6 report as a launch blocker.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://algotraders24.ai";
const TITLE = "Algotraders24 AI — AI Trading Intelligence Platform";
const DESCRIPTION =
  "Deterministic, evidence-based market analysis explained in plain language. Explainable AI intelligence for retail traders, professionals, brokers, and institutions.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s — Algotraders24 AI",
  },
  description: DESCRIPTION,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    siteName: "Algotraders24 AI",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
};

// Sprint H1.6 - minimal, honest structured data: only facts already true
// elsewhere in the codebase (name, real domain, the same description used
// in metadata above). No logo (no real asset), no sameAs (no confirmed
// social profiles), no address/founding date/SearchAction - all would be
// invented.
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "Algotraders24 AI",
      url: SITE_URL,
      description: DESCRIPTION,
    },
    {
      "@type": "WebSite",
      name: "Algotraders24 AI",
      url: SITE_URL,
    },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${displaySerif.variable}`}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
