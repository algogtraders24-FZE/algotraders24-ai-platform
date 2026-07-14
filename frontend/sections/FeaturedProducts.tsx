// sections/FeaturedProducts.tsx
// Sprint 14E - Server Component. Featured products now come from PostgreSQL
// via ProductCatalogue. Markup, layout and styling are unchanged.
import Link from "next/link";
import { ProductCatalogue } from "@/services/products/ProductCatalogue";
import type { Product } from "@/types/product";

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
  const products = all.slice(0, 6);

  return (
    <section className="bg-[#0C1324] text-white py-24">
      <div className="max-w-7xl mx-auto px-6">
        {/* Heading */}
        <div className="text-center mb-16">
          <span className="text-blue-500 font-semibold tracking-wide uppercase text-sm">
            Featured Products
          </span>
          <h2 className="text-4xl md:text-5xl font-bold mt-4">
            AI Trading Software That Works
          </h2>
          <p className="text-gray-400 mt-4 max-w-2xl mx-auto text-lg">
            Premium Expert Advisors, indicators and bots built with
            advanced AI for every major trading platform.
          </p>
        </div>

        {/* Product Cards */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {products.map((product) => {
            const badge = badgeFor(product);
            return (
              <div
                key={product.id}
                className="rounded-2xl bg-[#111827] border border-[#1F2937] p-6 flex flex-col hover:border-blue-500 transition duration-300"
              >
                {/* Top: tag + badge */}
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-semibold bg-blue-600/20 text-blue-400 px-3 py-1 rounded-full">
                    {tagFor(product)}
                  </span>
                  {badge && (
                    <span className="text-xs font-semibold bg-purple-600/20 text-purple-400 px-3 py-1 rounded-full">
                      {badge}
                    </span>
                  )}
                </div>

                {/* Name + platform */}
                <h3 className="text-xl font-bold mb-1">{product.name}</h3>
                <p className="text-blue-400 text-sm mb-3">{product.platform}</p>

                {/* Description */}
                <p className="text-gray-400 text-sm flex-grow">
                  {product.shortDescription}
                </p>

                {/* Bottom: price + button */}
                <div className="flex items-center justify-between mt-6">
                  <span className="text-2xl font-bold">${product.price}</span>
                  <Link
                    href={`/products/${product.slug}`}
                    className="bg-blue-600 hover:bg-blue-700 px-5 py-2 rounded-xl font-semibold transition"
                  >
                    Buy Now
                  </Link>
                </div>
              </div>
            );
          })}
        </div>

        {/* View all button */}
        <div className="text-center mt-12">
          <Link
            href="/products"
            className="inline-block border border-gray-600 hover:border-blue-500 px-8 py-4 rounded-xl font-semibold transition"
          >
            View All Products
          </Link>
        </div>
      </div>
    </section>
  );
}