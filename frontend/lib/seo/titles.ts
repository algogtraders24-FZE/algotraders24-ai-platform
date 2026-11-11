// lib/seo/titles.ts
// Length rules for <title> and <meta name="description"> (the 2026-11-11 Search Console audit found 74 titles over 65 characters, 19
// descriptions outside 70-160 and MT4/TradingView twins with the same description), plus the wording of the static pages' descriptions
// in ONE place so a test can hold them to the rules (a page file may only export `metadata`, so the text cannot live in the page).
//
// The root layout appends BRAND_SUFFIX to every page title (app/layout.tsx `template`). Google shows about 60 characters.

export const BRAND_SUFFIX = " — Algotraders24 AI";
export const TITLE_MAX = 60;
export const DESCRIPTION_MIN = 70;
export const DESCRIPTION_MAX = 155;

/** A title for `metadata.title`: plain when title + brand suffix fits `max`; otherwise the suffix is dropped (`absolute`), and a title that
 *  is still too long is cut on a word boundary. */
export function pageTitle(title: string, max: number = TITLE_MAX): string | { absolute: string } {
  const clean = title.replace(/\s+/g, " ").trim();
  if (clean.length + BRAND_SUFFIX.length <= max) return clean;
  if (clean.length <= max) return { absolute: clean };
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return { absolute: cut.slice(0, space > 30 ? space : max).replace(/[\s,;:\-–—|]+$/, "") };
}

/** The title as it will be rendered (what the length rule applies to). */
export function renderedTitle(t: string | { absolute: string }): string {
  return typeof t === "string" ? `${t}${BRAND_SUFFIX}` : t.absolute;
}

/** Makes twin listings (the MT4 and TradingView build of one indicator share their text) distinct by leading with the platform. */
export function withPlatform(description: string, platform: string | null | undefined, max: number = DESCRIPTION_MAX): string {
  const p = (platform ?? "").trim();
  if (!p || description.toLowerCase().includes(p.toLowerCase())) return description;
  const text = `${p}: ${description}`;
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > 80 ? space : max - 1).replace(/[,;:\-\s]+$/, "")}…`;
}

export const PAGE_TEXT = {
  marketsIndex: {
    title: "Live markets: expected range and key levels",
    description: "Gold, silver, EUR/USD, GBP/USD, USD/JPY, Bitcoin and Ethereum: expected 12h and 24h range (self-checked), key levels and macro drivers. No buy/sell calls.",
  },
  marketplaceIndex: {
    title: "Marketplace: independently verified trading systems",
    description: "Browse trading systems with evidence, validation and risk analysis computed by AT24, with a Trust State on every listing. No seller-authored claims.",
  },
  blog: {
    description: "Daily evidence-backed analysis of gold, forex and crypto: key levels, macro drivers and expected ranges. Research, never buy or sell calls.",
  },
  resources: {
    description: "Guides, FAQ, documentation, tutorials and research for Algotraders24 AI: how the platform works, what it does not do, and how to get started.",
  },
  company: {
    description: "About Algotraders24 AI: our story, vision and values, the team behind the platform, and how to get in touch with us.",
  },
  contact: {
    description: "Contact the Algotraders24 AI team on WhatsApp, Telegram or email for support, licence questions and partnership enquiries.",
  },
  disclaimer: {
    description: "Risk and AI-output disclosures for Algotraders24 AI: our tools are decision support, not financial advice, and trading carries a risk of loss.",
  },
  documentation: {
    description: "How Algotraders24 AI works: the analysis pipeline, what each tool does and does not do, plans and credits, the marketplace, licences and policies.",
  },
  tutorials: {
    description: "Step-by-step guides: backtest a trading idea for free, use your licence key in MetaTrader, connect Live Sync, analyse your trades and set alerts.",
  },
  research: {
    description: "Our own tests of what predicts price and what does not, including results that went against us: smart-money structure, CFTC positioning, volatility ranges.",
  },
  roadmap: {
    description: "Where Algotraders24 AI is heading over five years: a trusted retail platform, then a marketplace, professional tools and a developer platform.",
  },
} as const;

/** Market hub pages (/markets/<slug>). */
export function marketTitle(name: string): string | { absolute: string } {
  return pageTitle(`${name}: expected range and key levels`);
}
export function marketDescription(name: string): string {
  return `${name} market context: expected 12h and 24h range (self-checked), yesterday's high and low, macro drivers and releases. No buy or sell calls.`;
}
