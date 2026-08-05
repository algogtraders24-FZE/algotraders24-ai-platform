// sections/FeaturedProducts.tsx
// Sprint 14E - Server Component. Featured products now come from PostgreSQL
// via ProductCatalogue.
// Sprint H1.5 - repositioned per explicit direction: this section is no
// longer the homepage's hero pitch, it's part of the platform ecosystem
// narrative ("built on the same engine", not "buy our indicators"). Data
// layer, product logic, and card contents are untouched - only the framing
// copy and visual styling (old blue/purple theme -> the H1.3 token system,
// for consistency with every other section) changed.
//
// Sprint D2.4.A2 - homepage compression trimmed the shown count from 6 to 3;
// the full catalogue (this same query, unsliced) is one click away at
// /products, so nothing here was removed, only shown more sparingly.
import Link from "next/link";
import { ProductCatalogue } from "@/services/products/ProductCatalogue";
import type { Product } from "@/types/product";
import RevealOnScroll from "@/components/motion/RevealOnScroll";

// Short platform tag shown on the card (derived from the product platform).
function tagFor(product: Product): string {
  const p = product.platform.toLowerCase();
  if (p.includes("metatrader 5")) return "MT5";
  if (p.includes("metatrader 4")) return "MT4";
  if (p.includes("tradingview")) return "TradingView";
  if (p.includes("ctrader")) return "cTrader";
  if (p.includes("ninjatrader")) return "NinjaTrader";
  if (product.category === "crypto-bots") return "Crypto";
  if (product.category === "indian-market-algos") return "NSE";
  return product.platform;
}

// Badge is derived from catalogue signals, not stored separately.
function badgeFor(product: Product): string {
  if (product.downloads >= 3000) return "Best Seller";
  if (product.rating >= 4.7) return "Popular";
  const released = new Date(product.releaseDate).getTime();
  const ninetyDays = 90 * 24 * 60 * 60 * 1000;
  if (Date.now() - released < ninetyDays) return "New";
  return "";
}

export const revalidate = 300;

export default async function FeaturedProducts() {
  const all = await ProductCatalogue.getFeatured();
  const products = all.slice(0, 3);

  return (
    <section className="bg-ink py-16 text-text md:py-24">
      <div className="max-w-7xl mx-auto px-6">
        {/* Heading */}
        <div className="text-center mb-16 mx-auto max-w-2xl">
          <span className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">
            From The Platform Ecosystem
          </span>
          <h2 className="mt-4 font-display text-4xl font-medium md:text-5xl">
            Tools built on the same intelligence
          </h2>
          <p className="mt-5 text-lg text-text-2">
            Every product below runs on the platform&apos;s deterministic evidence-and-reasoning engine —
            not a standalone script.
          </p>
        </div>

        {/* Product Cards */}
        <RevealOnScroll>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {products.map((product) => {
            const badge = badgeFor(product);
            return (
              <div
                key={product.id}
                className="rounded-card border border-border bg-ink-2 p-6 flex flex-col transition-all duration-300 hover:-translate-y-1 hover:border-gold hover:shadow-raised"
              >
                {/* Top: tag + badge */}
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-medium rounded-control border border-gold/30 bg-gold/10 text-gold px-3 py-1">
                    {tagFor(product)}
                  </span>
                  {badge && (
                    <span className="text-xs font-medium rounded-control border border-signal-up/30 bg-signal-up/10 text-signal-up px-3 py-1">
                      {badge}
                    </span>
                  )}
                </div>

                {/* Name + platform */}
                <h3 className="text-xl font-semibold mb-1">{product.name}</h3>
                <p className="text-text-3 text-sm mb-3">{product.platform}</p>

                {/* Description */}
                <p className="text-text-2 text-sm leading-6 flex-grow">
                  {product.shortDescription}
                </p>

                {/* Bottom: price + button */}
                <div className="flex items-center justify-between mt-6">
                  <span className="text-2xl font-semibold">${product.price}</span>
                  <Link
                    href={`/products/${product.slug}`}
                    className="rounded-control bg-gold px-5 py-2 font-semibold text-ink transition hover:brightness-110"
                  >
                    View Details
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
        </RevealOnScroll>

        {/* View all button */}
        <div className="text-center mt-12">
          <Link
            href="/products"
            className="inline-block rounded-control border border-border px-8 py-4 font-semibold text-text transition hover:border-gold"
          >
            View All Products
          </Link>
        </div>
      </div>
    </section>
  );
}