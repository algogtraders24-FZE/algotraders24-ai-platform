import type { Product } from "@/types/product";

export default function ProductHero({ product }: { product: Product }) {
  return (
    <section className="pt-32 pb-12 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <span className="text-xs font-semibold bg-blue-600/20 text-blue-400 px-3 py-1 rounded-full">
            {product.platform}
          </span>
          {product.featured && (
            <span className="text-xs font-semibold bg-purple-600/20 text-purple-400 px-3 py-1 rounded-full">
              Featured
            </span>
          )}
          {product.status === "beta" && (
            <span className="text-xs font-semibold bg-yellow-600/20 text-yellow-400 px-3 py-1 rounded-full">
              Beta
            </span>
          )}
        </div>

        <h1 className="text-4xl md:text-6xl font-bold">{product.name}</h1>
        <p className="text-gray-400 mt-4 max-w-2xl text-lg">
          {product.shortDescription}
        </p>

        <div className="flex items-center gap-6 mt-6 text-sm text-gray-400">
          <span className="text-yellow-400">★ {product.rating.toFixed(1)}</span>
          <span>{product.downloads.toLocaleString()} downloads</span>
          <span>v{product.version}</span>
        </div>

        <div className="flex items-center gap-4 mt-8">
          <span className="text-3xl font-bold">
            ${product.price}
            <span className="text-base text-gray-400 font-normal ml-1">
              {product.currency}
            </span>
          </span>
        </div>
      </div>
    </section>
  );
}