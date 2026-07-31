import Link from "next/link";
import type { Product } from "@/types/product";

interface ProductCardProps {
  product: Product;
}

export default function ProductCard({ product }: ProductCardProps) {
  return (
    <div className="rounded-2xl bg-ink-3 border border-border p-6 flex flex-col hover:border-gold transition duration-300">
      {/* Top: platform tag + status/featured badge */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-semibold bg-gold/20 text-gold px-3 py-1 rounded-full">
          {product.platform}
        </span>
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
      <p className="text-text-2 text-sm flex-grow">
        {product.shortDescription}
      </p>

      {/* Rating + downloads */}
      <div className="flex items-center gap-4 mt-4 text-sm text-text-2">
        <span className="text-warning">★ {product.rating.toFixed(1)}</span>
        <span>{product.downloads.toLocaleString()} downloads</span>
      </div>

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