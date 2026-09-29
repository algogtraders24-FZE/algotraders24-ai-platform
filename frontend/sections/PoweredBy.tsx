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
// Text wordmarks only - no fetched/downloaded logo image files (most of
// these companies' brand guidelines restrict logo usage without
// approval; a plain, muted name avoids that risk entirely while still
// being honest and legible).
const PROVIDERS = [
  "MetaTrader 5",
  "Twelve Data",
  "Alpha Vantage",
  "Binance",
  "Angel One",
  "Anthropic Claude",
  "Google Gemini",
  "Supabase",
  "Vercel",
  "Cloudflare",
  "Stripe",
  "NOWPayments",
] as const;

function ProviderRow({ ariaHidden }: { ariaHidden?: boolean }) {
  return (
    <div className="flex shrink-0 items-center gap-12 pr-12" aria-hidden={ariaHidden}>
      {PROVIDERS.map((name) => (
        <span key={name} className="whitespace-nowrap text-sm font-semibold tracking-wide text-text-3">
          {name}
        </span>
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
