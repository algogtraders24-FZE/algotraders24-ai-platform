// sections/PoweredBy.tsx
// Beta User Testing homepage-content pass (2026-09-29) - an honest
// "built on real infrastructure" strip, styled as a continuous scroll
// per the owner's own reference. Deliberately NOT called "Partners":
// none of these are formal, mutual partnerships (no co-marketing, no
// agreement, no endorsement from them) - they are real vendors/providers
// AT24 pays for and integrates with. Framing it as "Powered By" keeps
// the claim exactly as true as it is, matching this codebase's standing
// no-fabricated-trust-signal rule (see TrustStrip.tsx's own header
// comment: "no partner logos, no borrowed trust").
//
// Every name below is a real, already-disclosed or directly-verified
// integration - never invented for this strip:
//   - MetaTrader 5 (Exness), Twelve Data, Alpha Vantage, Binance, Angel One:
//     real market-data providers, MarketDataService's own provider order.
//   - Anthropic (Claude): the K3 orchestrator's native web search / AI
//     Assistant reasoning layer.
//   - Google (Gemini): Market Intelligence's explanation layer - the
//     live product literally attributes its own output to it ("Presented
//     by Gemini").
//   - Supabase, Vercel, Cloudflare: already named as real vendors in
//     /company/privacy-policy ("authentication provider, Supabase";
//     "hosting and security providers (Vercel and Cloudflare)").
//   - Stripe, NOWPayments: the two real, live checkout providers
//     (services/billing/providers/, services/marketplace/ payment routes).
//
// Real brand marks via `simple-icons` (npm, MIT-licensed SVG path data for
// official brand logos) for the providers it actually covers - no raw
// downloads of logo image files from arbitrary web sources. 5 of the 12
// providers below (MetaTrader 5, Twelve Data, Alpha Vantage, Angel One,
// NOWPayments) have no simple-icons entry - that library is scoped to
// general tech/dev-tool brands, not niche broker/market-data vendors - so
// those stay text-only wordmarks, mixed in with the logo'd ones.
//
// Vercel (#000000) and Anthropic (#191919) ship as near-black marks meant
// for light backgrounds; simple-icons' own hex would be nearly invisible
// on this site's dark ink background, so those two render in a neutral
// light tone instead of their literal brand hex (Vercel's own brand kit
// explicitly ships a white logotype variant for dark surfaces) - every
// other icon below renders in its real, unmodified brand color.
import { siStripe, siVercel, siSupabase, siCloudflare, siBinance, siAnthropic, siGooglegemini } from "simple-icons";

type Provider = {
  name: string;
  icon?: { path: string; hex: string; invertOnDark?: boolean };
};

const PROVIDERS: Provider[] = [
  { name: "MetaTrader 5" },
  { name: "Twelve Data" },
  { name: "Alpha Vantage" },
  { name: "Binance", icon: { path: siBinance.path, hex: siBinance.hex } },
  { name: "Angel One" },
  { name: "Anthropic Claude", icon: { path: siAnthropic.path, hex: siAnthropic.hex, invertOnDark: true } },
  { name: "Google Gemini", icon: { path: siGooglegemini.path, hex: siGooglegemini.hex } },
  { name: "Supabase", icon: { path: siSupabase.path, hex: siSupabase.hex } },
  { name: "Vercel", icon: { path: siVercel.path, hex: siVercel.hex, invertOnDark: true } },
  { name: "Cloudflare", icon: { path: siCloudflare.path, hex: siCloudflare.hex } },
  { name: "Stripe", icon: { path: siStripe.path, hex: siStripe.hex } },
  { name: "NOWPayments" },
];

function ProviderBadge({ provider }: { provider: Provider }) {
  return (
    <div className="flex shrink-0 items-center gap-2.5">
      {provider.icon ? (
        <svg
          viewBox="0 0 24 24"
          className={provider.icon.invertOnDark ? "h-5 w-5 shrink-0 text-text-2" : "h-5 w-5 shrink-0"}
          style={provider.icon.invertOnDark ? undefined : { fill: `#${provider.icon.hex}` }}
          fill={provider.icon.invertOnDark ? "currentColor" : undefined}
          aria-hidden="true"
        >
          <path d={provider.icon.path} />
        </svg>
      ) : null}
      <span className="whitespace-nowrap text-sm font-semibold tracking-wide text-text-3">{provider.name}</span>
    </div>
  );
}

function ProviderRow({ ariaHidden }: { ariaHidden?: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-12 pr-12" aria-hidden={ariaHidden}>
      {PROVIDERS.map((provider) => (
        <ProviderBadge key={provider.name} provider={provider} />
      ))}
    </div>
  );
}

export default function PoweredBy() {
  return (
    <div className="border-b border-border py-10">
      <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-text-3">
        Built on real infrastructure — not marketing partners
      </p>
      <div
        className="relative mt-6 overflow-hidden"
        style={{
          maskImage: "linear-gradient(to right, transparent, black 8%, black 92%, transparent)",
          WebkitMaskImage: "linear-gradient(to right, transparent, black 8%, black 92%, transparent)",
        }}
      >
        <div className="flex w-max animate-marquee">
          <ProviderRow />
          <ProviderRow ariaHidden />
        </div>
      </div>
    </div>
  );
}
