import type { Metadata } from "next";
import { Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";
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
export const metadata: Metadata = {
  title: "Algotraders24 AI — AI Trading Intelligence Platform",
  description:
    "Deterministic, evidence-based market analysis explained in plain language. Explainable AI intelligence for retail traders, professionals, brokers, and institutions.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${displaySerif.variable}`}>
      <body>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
