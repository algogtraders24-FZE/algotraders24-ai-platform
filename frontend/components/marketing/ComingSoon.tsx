// components/marketing/ComingSoon.tsx
// Sprint D2.4.A1 - the honest alternative to a fabricated page. Used for
// every IA destination that has real nav/footer placement but no real
// content yet (Solutions audience pages, most of Resources/Company). Never
// invents copy to look finished - states plainly what this will become and
// links back to somewhere real, so it's never a dead end.
import Link from "next/link";

export default function ComingSoon({ label }: { label: string }) {
  return (
    <div className="mx-auto max-w-xl px-6 py-16 text-center">
      <p className="rounded-control border border-gold/30 bg-gold/10 px-4 py-2 text-sm font-medium text-gold">
        {label} is coming soon
      </p>
      <p className="mt-4 text-sm leading-6 text-text-2">
        This section isn&apos;t built yet — we&apos;d rather show that honestly than fill it with placeholder content.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-4">
        <Link
          href="/"
          className="rounded-control border border-border px-5 py-2.5 text-sm font-medium text-text transition hover:border-gold"
        >
          Back to Home
        </Link>
        <Link
          href="/products"
          className="rounded-control border border-border px-5 py-2.5 text-sm font-medium text-text transition hover:border-gold"
        >
          Browse Products
        </Link>
      </div>
    </div>
  );
}
