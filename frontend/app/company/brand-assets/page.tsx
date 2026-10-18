// app/company/brand-assets/page.tsx
// Brand Assets: the official logo files (already served from /public/brand), the four official colours and the usage rules
// from the brand package README. Colours are the real tokens in app/globals.css. Nothing here is a new design.
import type { Metadata } from "next";
import Link from "next/link";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import PageHero from "@/components/marketing/PageHero";
import Card from "@/components/ui/Card";

export const metadata: Metadata = {
  title: "Brand Assets",
  description: "Official Algotraders24 AI logos, colours and usage rules, for partners, press and anyone who needs to show our brand correctly.",
  alternates: { canonical: "/company/brand-assets" },
};

const LOGOS = [
  { name: "Full logo (mark + name)", file: "/brand/algotraders24-lockup.svg", format: "SVG", note: "Preferred wherever it fits." },
  { name: "Logo mark only", file: "/brand/algotraders24-mark.svg", format: "SVG", note: "For small sizes, avatars and icons." },
  { name: "Logo, 512 px", file: "/brand/logo-512.png", format: "PNG", note: "For places that do not accept SVG." },
] as const;

const COLOURS = [
  { name: "Deep Black", hex: "#0B0F19", use: "Backgrounds", text: "text-white" },
  { name: "Metallic Gold", hex: "#D4AF37", use: "Accent and calls to action", text: "text-black" },
  { name: "Slate Accent", hex: "#94A3B8", use: "Secondary text", text: "text-black" },
  { name: "White", hex: "#FFFFFF", use: "Primary text on dark", text: "text-black" },
] as const;

const RULES = [
  "Use the logo exactly as provided. Do not redraw, recolour, stretch or add effects to it.",
  "Use the SVG wherever you can; use the PNG only where SVG is not accepted.",
  "Keep clear space around the logo and place it on a dark background, as it appears on our site.",
  "Do not imply that AT24 endorses, certifies or is partnered with you unless we have agreed that in writing.",
  "Do not use the logo on materials that promise trading results.",
] as const;

export default function BrandAssetsPage() {
  return (
    <main className="min-h-screen bg-ink text-text">
      <Navbar />
      <PageHero
        eyebrow="Company / Brand assets"
        title="Brand assets"
        subtitle="The official logo files, colours and rules for showing the Algotraders24 AI brand correctly."
      />

      <section className="px-6 py-12">
        <div className="mx-auto max-w-4xl space-y-12">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Logos</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {LOGOS.map((l) => (
                <Card key={l.file} padding="md" className="flex flex-col">
                  <div className="flex h-32 items-center justify-center rounded-control bg-ink p-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={l.file} alt={l.name} className="max-h-full max-w-full object-contain" />
                  </div>
                  <h3 className="mt-4 text-sm font-semibold">{l.name}</h3>
                  <p className="mt-1 text-xs text-text-3">{l.note}</p>
                  <a
                    href={l.file}
                    download
                    className="mt-3 inline-block text-sm font-semibold text-gold underline-offset-4 hover:underline"
                  >
                    Download {l.format}
                  </a>
                </Card>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Colours</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {COLOURS.map((c) => (
                <div key={c.hex} className="overflow-hidden rounded-card border border-border">
                  <div className={`flex h-24 items-end p-3 text-sm font-semibold ${c.text}`} style={{ backgroundColor: c.hex }}>
                    {c.hex}
                  </div>
                  <div className="bg-ink-2 p-3">
                    <p className="text-sm font-semibold">{c.name}</p>
                    <p className="text-xs text-text-3">{c.use}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Using the brand</h2>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-text-2">
              {RULES.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="mt-6 text-sm text-text-2">
              Writing about us? The{" "}
              <Link href="/company/media-kit" className="text-gold underline-offset-4 hover:underline">
                Media Kit
              </Link>{" "}
              has the facts and a short description you can use. For anything else,{" "}
              <Link href="/company/contact" className="text-gold underline-offset-4 hover:underline">
                contact us
              </Link>
              .
            </p>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
