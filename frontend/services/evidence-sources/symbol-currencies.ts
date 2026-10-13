// services/evidence-sources/symbol-currencies.ts
// Which currencies' scheduled events matter for a symbol. Pure.
import { profileForMiSymbol } from "@/services/macro/macro-alignment";

const KNOWN = new Set(["USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "CNY"]);

export function currenciesForSymbol(symbol: string): string[] {
  const profile = profileForMiSymbol(symbol);
  if (profile) return [...profile.calendarCurrencies];
  const s = symbol.toUpperCase();
  if (/^[A-Z]{6}$/.test(s)) {
    const pair = [s.slice(0, 3), s.slice(3)].filter((c) => KNOWN.has(c));
    if (pair.length > 0) return pair;
  }
  return ["USD"]; // metals, crypto and anything else are quoted in dollars
}
