// services/evidence-sources/news-relevance.ts
// Deterministic relevance filter for stored headlines. The news store tags an
// article to a symbol from loose topic/keyword matches, so a EUR/USD analysis was
// "supported" by Waste Management and Kroger stories and a Gold analysis by
// individual mining-stock headlines. A headline is kept only when it names the
// instrument (or its currency / central bank), or is broad US-dollar macro news for
// a dollar-quoted instrument - and company/stock-pick headlines are dropped. No
// match means no news evidence: an honest absence, never padding.

const USD_MACRO = /\b(dollar index|dxy|u\.?s\.? dollar|greenback|federal reserve|the fed\b|fomc|powell|nonfarm|non-farm|payrolls|u\.?s\.? (cpi|inflation|jobs)|treasury yields?)\b/i;

const SYMBOL_TERMS: Record<string, { own: RegExp; usdMacro: boolean }> = {
  XAUUSD: { own: /\b(gold|xau|bullion|precious metals?)\b/i, usdMacro: true },
  XAGUSD: { own: /\b(silver|xag|precious metals?)\b/i, usdMacro: true },
  EURUSD: { own: /\b(euro|eur\/?usd|ecb|eurozone|euro zone|european central bank|lagarde)\b/i, usdMacro: true },
  GBPUSD: { own: /\b(pound|sterling|gbp\/?usd|bank of england|boe|cable)\b/i, usdMacro: true },
  USDJPY: { own: /\b(yen|usd\/?jpy|bank of japan|boj|jgbs?|japan(ese)?)\b/i, usdMacro: true },
  BTCUSD: { own: /\b(bitcoin|btc|crypto(currency|currencies)?|spot bitcoin etf)\b/i, usdMacro: false },
  ETHUSD: { own: /\b(ethereum|ether|eth|crypto(currency|currencies)?)\b/i, usdMacro: false },
  SOLUSD: { own: /\b(solana|sol|crypto(currency|currencies)?)\b/i, usdMacro: false },
  XRPUSD: { own: /\b(xrp|ripple|crypto(currency|currencies)?)\b/i, usdMacro: false },
};

/** Company / stock-pick headlines: about a listed company or a stock tip, not the instrument. */
const COMPANY_NEWS = /\((NYSE|NASDAQ|TSX|TSXV|ASX|LSE|NSE|BSE|OTC)[:\s]|\bstock picks?\b|\bstock sits\b|\bshare price\b|\bbrokerages?'? radar\b|\bquarterly (earnings|results|market expectations)\b/i;

export function isRelevantHeadline(symbol: string, headline: string): boolean {
  const terms = SYMBOL_TERMS[symbol.toUpperCase()];
  if (!terms) return false; // no rule for this symbol: keep nothing rather than guess
  if (COMPANY_NEWS.test(headline)) return false;
  if (terms.own.test(headline)) return true;
  return terms.usdMacro && USD_MACRO.test(headline);
}
