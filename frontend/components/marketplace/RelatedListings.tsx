// components/marketplace/RelatedListings.tsx
// Plain crawlable <a href> links between listings that belong together (trade copiers, Gold EAs, the XXX line).
// Search Console found several listings with no internal link at all (only the sitemap), so Google never crawled them.
// Server component, no data fetch: the groups are a fixed, hand-picked map of real listing slugs.
import Link from "next/link";

type Item = { slug: string; label: string };
type Group = { heading: string; items: Item[] };

const GROUPS: Group[] = [
  {
    heading: "More trade copiers",
    items: [
      { slug: "at24-local-trade-copier-mt4-to-mt4", label: "Trade copier MT4 to MT4" },
      { slug: "at24-local-trade-copier-mt4-to-mt5", label: "Trade copier MT4 to MT5" },
      { slug: "at24-local-trade-copier-mt5-to-mt4", label: "Trade copier MT5 to MT4" },
      { slug: "at24-local-trade-copier-mt5-to-mt5", label: "Trade copier MT5 to MT5" },
    ],
  },
  {
    heading: "More Gold systems",
    items: [
      { slug: "gold-sniper-xauusd-m1-pending-scalper", label: "Gold Sniper" },
      { slug: "gold-oob-scalper", label: "Gold OOB Scalper" },
      { slug: "speed-of-gold-pro", label: "Speed of Gold Pro" },
      { slug: "gold-hedge", label: "Gold Hedge" },
      { slug: "at24-gold-range-breaker", label: "Gold Range Breaker" },
      { slug: "xxx-gold-multi-module-breakout", label: "XXX Gold" },
    ],
  },
  {
    heading: "The XXX breakout line",
    items: [
      { slug: "xxx-us30-multi-module-breakout", label: "XXX US30" },
      { slug: "xxx-btc-multi-module-breakout", label: "XXX BTC" },
      { slug: "xxx-gold-multi-module-breakout", label: "XXX Gold" },
    ],
  },
];

export default function RelatedListings({ slug }: { slug: string }) {
  const groups = GROUPS.filter((g) => g.items.some((i) => i.slug === slug))
    .map((g) => ({ ...g, items: g.items.filter((i) => i.slug !== slug) }))
    .filter((g) => g.items.length > 0);
  if (groups.length === 0) return null;
  return (
    <nav aria-label="Related systems" className="mx-auto max-w-5xl px-6 pb-12">
      {groups.map((g) => (
        <div key={g.heading} className="mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-3">{g.heading}</h2>
          <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
            {g.items.map((i) => (
              <li key={i.slug}>
                <Link href={`/marketplace/${i.slug}`} className="text-text-2 hover:text-gold">
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="mt-6 text-sm text-text-3">
        <Link href="/marketplace" className="text-gold hover:underline">Browse the whole marketplace</Link>
        {" · "}
        <Link href="/demo" className="text-gold hover:underline">Free 30-day XXX US30 demo</Link>
      </p>
    </nav>
  );
}
