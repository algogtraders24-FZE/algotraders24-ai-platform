import type { Product } from "@/types/product";

// Sprint R1.0.1 - Both buttons here were rendered as if live (no onClick,
// no href, no disabled state) with nothing behind them - a user who
// clicked either got silent, confusing non-response. No checkout or demo-
// request pipeline exists yet (that's a real feature, out of this sprint's
// "no new features" scope), so these are now honestly disabled rather than
// left looking clickable while doing nothing.
export default function ProductCTA({ product }: { product: Product }) {
  return (
    <section className="px-6 mb-16">
      <div className="max-w-7xl mx-auto">
        <div className="rounded-3xl bg-gradient-to-r from-gold to-gold p-10 md:p-14 text-center">
          <h2 className="text-2xl md:text-4xl font-bold">Get {product.name} Today</h2>
          <p className="text-gold mt-3">
            Instant download • Lifetime updates • Priority support
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
            <button
              disabled
              title="Online checkout isn't available yet"
              className="cursor-not-allowed bg-ink-3 text-text-3 px-8 py-4 rounded-xl font-semibold"
            >
              Buy Now — ${product.price} (Coming Soon)
            </button>
            <button
              disabled
              title="Demo requests aren't available yet"
              className="cursor-not-allowed border border-border text-text/50 px-8 py-4 rounded-xl font-semibold"
            >
              Request Demo (Coming Soon)
            </button>
          </div>
          <p className="mt-4 text-sm text-gold/80">
            Purchasing and demo requests are not yet available on the platform.
          </p>
        </div>
      </div>
    </section>
  );
}