// sections/XxxLineStrip.tsx
// Homepage strip: crawlable links to the XXX breakout line and the free demo. The homepage used to link none of the XXX
// listings, so Search Console showed them as "Discovered - currently not indexed". Plain static links, no data fetch,
// no performance claim.
import Link from "next/link";

const ITEMS = [
  { href: "/marketplace/xxx-us30-multi-module-breakout", name: "XXX US30", note: "Multi-module breakout EA for the US30 index" },
  { href: "/marketplace/xxx-gold-multi-module-breakout", name: "XXX Gold", note: "Multi-module breakout EA for Gold" },
  { href: "/marketplace/xxx-btc-multi-module-breakout", name: "XXX BTC", note: "Multi-module breakout EA for Bitcoin" },
];

export default function XxxLineStrip() {
  return (
    <section className="bg-ink pb-16 text-text">
      <div className="mx-auto max-w-7xl px-6">
        <h2 className="font-display text-2xl font-medium md:text-3xl">The XXX breakout line</h2>
        <p className="mt-2 max-w-2xl text-text-2">
          Three breakout EAs for MetaTrader 5. Try XXX US30 free for 30 days on your own demo account, then read each product page for its
          evidence and its weak points.
        </p>
        <ul className="mt-6 grid gap-4 sm:grid-cols-3">
          {ITEMS.map((i) => (
            <li key={i.href}>
              <Link href={i.href} className="block rounded-panel border border-border bg-ink-2 p-5 transition-colors hover:border-gold/40">
                <p className="font-semibold text-text">{i.name}</p>
                <p className="mt-1 text-sm text-text-2">{i.note}</p>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm">
          <Link href="/demo" className="text-gold hover:underline">Start the free 30-day demo</Link>
          <span className="text-text-3"> · Demo accounts only. Trading involves risk.</span>
        </p>
      </div>
    </section>
  );
}
