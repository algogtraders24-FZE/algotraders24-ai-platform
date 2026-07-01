import Link from "next/link";
import type { Product } from "@/types/product";

interface ProductCardProps {
  product: Product;
}

export default function ProductCard({ product }: ProductCardProps) {
  return (
    <div className="rounded-2xl bg-[#111827] border border-[#1F2937] p-6 flex flex-col hover:border-blue-500 transition duration-300">
      {/* Top: platform tag + status/featured badge */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-semibold bg-blue-600/20 text-blue-400 px-3 py-1 rounded-full">
          {product.platform}
        </span>
        {product.featured ? (
          <span className="text-xs font-semibold bg-purple-600/20 text-purple-400 px-3 py-1 rounded-full">
            Featured
          </span>
        ) : product.status === "beta" ? (
          <span className="text-xs font-semibold bg-yellow-600/20 text-yellow-400 px-3 py-1 rounded-full">
            Beta
          </span>
        ) : null}
      </div>

      {/* Name */}
      <h3 className="text-xl font-bold mb-2">{product.name}</h3>

      {/* Short description */}
      <p className="text-gray-400 text-sm flex-grow">
        {product.shortDescription}
      </p>

      {/* Rating + downloads */}
      <div className="flex items-center gap-4 mt-4 text-sm text-gray-400">
        <span className="text-yellow-400">★ {product.rating.toFixed(1)}</span>
        <span>{product.downloads.toLocaleString()} downloads</span>
      </div>

      {/* Bottom: price + button */}
      <div className="flex items-center justify-between mt-6">
        <span className="text-2xl font-bold">
          ${product.price}
          <span className="text-sm text-gray-400 font-normal ml-1">
            {product.currency}
          </span>
        </span>
        <Link
          href={`/products/${product.slug}`}
          className="bg-blue-600 hover:bg-blue-700 px-5 py-2 rounded-xl font-semibold transition"
        >
          View
        </Link>
      </div>
    </div>
  );
}