// components/product/ProductCard.tsx
// Sprint D2.4.A5 - "App Store"-style card, built from data/products.ts
// (features, supportedPlatforms) plus a category icon badge (data/
// categories.ts, reusing the same icons sections/Platforms/index.tsx uses
// for each ecosystem). No product screenshot or logo: none exist for any
// of the 10 products (every entry's `images` field is still the shared
// placeholder.png), and fabricating one per product would misrepresent a
// real screenshot as existing when it doesn't - this card is honest about
// what's real without looking bare, not a substitute for real product
// imagery arriving later.
//
// M14 fix - rating/downloads were NEVER real (this comment's own prior
// wording wrongly called them "real data"): every one of the 10 rows was
// hand-seeded with an invented star rating and download count, with no
// real review or download-tracking system behind either number. Removed
// from display rather than left showing fabricated social proof - same
// principle the real Marketplace (components/marketplace/
// MarketplaceListingCard.tsx) was built around from the start.
import Link from "next/link";
import type { Product } from "@/types/product";
import { CATEGORIES } from "@/data/categories";

interface ProductCardProps {
  product: Product;
}

export default function ProductCard({ product }: ProductCardProps) {
  const category = CATEGORIES.find((c) => c.id === product.category);
  const topFeatures = product.features.slice(0, 2);

  return (
    <div className="rounded-2xl bg-ink-3 border border-border p-6 flex flex-col hover:border-gold transition duration-300">
      {/* Top: category icon + platform tag + status/featured badge */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {category && (
            <span className="flex h-8 w-8 items-center justify-center rounded-control border border-gold/30 bg-gold/10">
              <category.icon className="h-4 w-4 text-gold" aria-hidden="true" />
            </span>
          )}
          <span className="text-xs font-semibold bg-gold/20 text-gold px-3 py-1 rounded-full">
            {product.platform}
          </span>
        </div>
        {product.featured ? (
          <span className="text-xs font-semibold bg-gold/20 text-gold px-3 py-1 rounded-full">
            Featured
          </span>
        ) : product.status === "beta" ? (
          <span className="text-xs font-semibold bg-warning/20 text-warning px-3 py-1 rounded-full">
            Beta
          </span>
        ) : null}
      </div>

      {/* Name */}
      <h3 className="text-xl font-bold mb-2">{product.name}</h3>

      {/* Short description */}
      <p className="text-text-2 text-sm">
        {product.shortDescription}
      </p>

      {/* Top features */}
      {topFeatures.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {topFeatures.map((feature) => (
            <li key={feature} className="flex items-start gap-2 text-xs text-text-2">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-gold" aria-hidden="true" />
              {feature}
            </li>
          ))}
        </ul>
      )}

      {/* Supported platforms */}
      {product.supportedPlatforms.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {product.supportedPlatforms.map((platform) => (
            <span key={platform} className="rounded-control border border-border px-2 py-0.5 text-[10px] font-medium text-text-3">
              {platform}
            </span>
          ))}
        </div>
      )}

      <div className="flex-grow" />

      {/* Bottom: price + button */}
      <div className="flex items-center justify-between mt-6">
        <span className="text-2xl font-bold">
          ${product.price}
          <span className="text-sm text-text-2 font-normal ml-1">
            {product.currency}
          </span>
        </span>
        <Link
          href={`/products/${product.slug}`}
          className="bg-gold hover:brightness-110 px-5 py-2 rounded-xl font-semibold transition"
        >
          View
        </Link>
      </div>
    </div>
  );
}
