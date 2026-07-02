import { notFound } from "next/navigation";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/sections/Footer";
import ProductHero from "@/components/product/ProductHero";
import ProductGallery from "@/components/product/ProductGallery";
import ProductFeatures from "@/components/product/ProductFeatures";
import ProductSpecifications from "@/components/product/ProductSpecifications";
import SupportedPlatforms from "@/components/product/SupportedPlatforms";
import ProductCTA from "@/components/product/ProductCTA";
import RelatedProducts from "@/components/product/RelatedProducts";
import { PRODUCTS } from "@/data/products";

// Har product ka page pehle se build ho jaye (fast + SEO-ready)
export function generateStaticParams() {
  return PRODUCTS.map((p) => ({ slug: p.slug }));
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = PRODUCTS.find((p) => p.slug === slug);

  if (!product) notFound();

  return (
    <main className="min-h-screen bg-[#050816] text-white">
      <Navbar />
      <ProductHero product={product} />
      <ProductGallery product={product} />

      {/* Overview */}
      <section className="px-6 mb-16">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold mb-4">Overview</h2>
          <p className="text-gray-400 leading-8 max-w-3xl">
            {product.fullDescription}
          </p>
        </div>
      </section>

      <ProductFeatures product={product} />
      <ProductSpecifications product={product} />
      <SupportedPlatforms product={product} />

      {/* Version info */}
      <section className="px-6 mb-16">
        <div className="max-w-7xl mx-auto grid sm:grid-cols-3 gap-4">
          <div className="rounded-xl bg-[#0C1324] border border-[#1F2937] p-5">
            <div className="text-gray-400 text-sm">Version</div>
            <div className="font-semibold mt-1">v{product.version}</div>
          </div>
          <div className="rounded-xl bg-[#0C1324] border border-[#1F2937] p-5">
            <div className="text-gray-400 text-sm">Released</div>
            <div className="font-semibold mt-1">{product.releaseDate}</div>
          </div>
          <div className="rounded-xl bg-[#0C1324] border border-[#1F2937] p-5">
            <div className="text-gray-400 text-sm">Last Updated</div>
            <div className="font-semibold mt-1">{product.lastUpdated}</div>
          </div>
        </div>
      </section>

      {/* FAQ (agar hai) */}
      {product.faqs && product.faqs.length > 0 && (
        <section className="px-6 mb-16">
          <div className="max-w-7xl mx-auto">
            <h2 className="text-2xl md:text-3xl font-bold mb-8">FAQ</h2>
            <div className="space-y-4">
              {product.faqs.map((faq, i) => (
                <div
                  key={i}
                  className="rounded-xl bg-[#0C1324] border border-[#1F2937] p-6"
                >
                  <div className="font-semibold">{faq.question}</div>
                  <div className="text-gray-400 mt-2">{faq.answer}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <ProductCTA product={product} />
      <RelatedProducts product={product} />
      <Footer />
    </main>
  );
}