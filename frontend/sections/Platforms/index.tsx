// sections/Platforms/index.tsx
// Sprint H1.5 - full redesign. The previous version pointed <Image> at
// /platforms/*.png files that don't exist (public/platforms is empty),
// producing a 404 for every card. Rather than fabricate placeholder logo
// images we don't have rights to, each platform gets a plain icon badge and
// its real name as text - no invented artwork standing in for a brand mark.
// Restyled onto the H1.3 token system for consistency with the rest of the
// page. Server Component: static content, no interactivity needed.
import type { LucideIcon } from "lucide-react";
import { Bot, LineChart, Workflow, Activity, Coins, Landmark } from "lucide-react";

const platforms: { title: string; subtitle: string; description: string; icon: LucideIcon }[] = [
  {
    title: "MetaTrader 5",
    subtitle: "Expert Advisors",
    description: "Automated trading solutions for MT5 with advanced AI.",
    icon: Bot,
  },
  {
    title: "TradingView",
    subtitle: "Indicators & Strategies",
    description: "Powerful indicators and strategies for TradingView.",
    icon: LineChart,
  },
  {
    title: "cTrader",
    subtitle: "Professional cBots",
    description: "High-performance cBots for cTrader platform.",
    icon: Workflow,
  },
  {
    title: "NinjaTrader",
    subtitle: "Automated Strategies",
    description: "Robust automated strategies for NinjaTrader.",
    icon: Activity,
  },
  {
    title: "Crypto Exchanges",
    subtitle: "Binance • Bybit • OKX",
    description: "AI trading bots for major crypto exchanges.",
    icon: Coins,
  },
  {
    title: "Indian Markets",
    subtitle: "NSE • BSE • MCX",
    description: "Algo trading solutions for Indian stock & commodity markets.",
    icon: Landmark,
  },
];

export default function Platforms() {
  return (
    <section className="bg-ink py-24 text-text">
      <div className="max-w-7xl mx-auto px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">Supported Platforms</p>
          <h2 className="mt-4 font-display text-4xl font-medium md:text-5xl">
            One AI platform. Multiple trading ecosystems.
          </h2>
          <p className="mt-5 text-lg text-text-2">Build once. Deploy everywhere.</p>
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {platforms.map((platform) => (
            <div
              key={platform.title}
              className="rounded-card border border-border bg-ink-2 p-8 transition-colors hover:border-gold"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-control border border-gold/30 bg-gold/10">
                <platform.icon className="h-7 w-7 text-gold" aria-hidden="true" />
              </div>

              <h3 className="mt-6 text-xl font-semibold">{platform.title}</h3>
              <p className="mt-1 text-sm font-medium text-gold">{platform.subtitle}</p>
              <p className="mt-4 text-sm leading-6 text-text-2">{platform.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
