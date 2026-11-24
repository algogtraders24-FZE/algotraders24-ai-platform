// lib/chart-engine/voice-commands.ts
// Turns what the trader SAID to PRAGYA into a chart command: change the timeframe, change the symbol, start the analysis, or (refused) place an order.
// Pure and unit-tested (scripts/validate-voice-commands.ts). English, Hindi (Roman or Devanagari) and Hinglish phrases are understood.
// A sentence is a command only when it is short and imperative ("show gold", "H4 chart", "daily par jao") or is just the name of the thing:
// a question such as "what is the trend on gold?" stays a question for PRAGYA. Orders are never executed from voice, only recognised so they can be refused.
import type { SignalTimeframe } from "@/types/signal";

export interface VoiceInstrument { symbol: string; label: string; name: string }

export type VoiceCommand =
  | { kind: "timeframe"; timeframe: SignalTimeframe }
  | { kind: "symbol"; phrase: string }
  | { kind: "analyze" }
  | { kind: "order" };

const norm = (s: string) => s.toLowerCase().replace(/[.,!?;:"“”']/g, " ").replace(/\s+/g, " ").trim();

const NUMBER_WORDS: Record<string, number> = {
  one: 1, ek: 1, एक: 1, two: 2, do: 2, दो: 2, three: 3, teen: 3, तीन: 3, four: 4, chaar: 4, char: 4, चार: 4, five: 5, paanch: 5, panch: 5, पाँच: 5, पांच: 5,
  fifteen: 15, pandrah: 15, पंद्रह: 15, thirty: 30, tees: 30, तीस: 30,
};

/** "4h", "h4", "4 hour", "four hours", "chaar ghante", "15 minute", "daily", "weekly" -> a chart timeframe, or null. */
export function parseTimeframe(textRaw: string): SignalTimeframe | null {
  const t = norm(textRaw);
  if (/\b(daily|day chart|din ka|रोज|दैनिक|1d|d1)\b/.test(t) || /\b(one|1|ek) (day|din)\b/.test(t)) return "1d";
  if (/\b(weekly|week chart|hafta|हफ्ता|साप्ताहिक|1w|w1)\b/.test(t) || /\b(one|1|ek) (week|hafte)\b/.test(t)) return "1w";
  const hc = /\bh\s?(1|4)\b/.exec(t) ?? /\b(1|4)\s?h\b/.exec(t);
  if (hc) return hc[1] === "4" ? "4h" : "1h";
  const mc = /\bm\s?(1|5|15|30)\b/.exec(t) ?? /\b(1|5|15|30)\s?m\b/.exec(t);
  if (mc) return (mc[1] + "m") as SignalTimeframe;
  const m = /\b(\d+|[a-zA-Zऀ-ॿ]+)\s?(hours?|hrs?|ghante|ghanta|घंटे|घंटा|minutes?|mins?|minute|मिनट)\b/.exec(t);
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
    const hours = /^(hours?|hrs?|ghante|ghanta|घंटे|घंटा)$/.test(m[2]);
    if (n !== undefined) {
      if (hours && n === 1) return "1h";
      if (hours && n === 4) return "4h";
      if (!hours && [1, 5, 15, 30].includes(n)) return (n + "m") as SignalTimeframe;
    }
  }
  return null;
}

// everyday names -> the symbol phrase the instrument list is searched with
const ALIASES: [RegExp, string][] = [
  [/\b(gold|sona|सोना|xau)\b/, "XAUUSD"],
  [/\b(silver|chandi|चांदी|xag)\b/, "XAGUSD"],
  [/\b(bitcoin|btc|बिटकॉइन)\b/, "BTCUSD"],
  [/\b(ethereum|ether|eth)\b/, "ETHUSD"],
  [/\b(crude|oil|wti|तेल)\b/, "USOIL"],
  [/\b(nasdaq|nas ?100|ustec)\b/, "USTEC"],
  [/\b(s ?and ?p|s&p|sp ?500|us ?500)\b/, "US500"],
  [/\b(dow|us ?30)\b/, "US30"],
  [/\b(euro ?dollar|eur ?usd|euro)\b/, "EURUSD"],
  [/\b(pound ?dollar|gbp ?usd|cable|pound)\b/, "GBPUSD"],
  [/\b(dollar ?yen|usd ?jpy|yen)\b/, "USDJPY"],
];

const CHANGE_VERB = /^(please |pls )?(show|open|switch|change|go|take|load|display|chart|dikhao|dikha|kholo|khol|lagao|laga|badlo|badal|chalo|jao|dekho)\b|\b(dikhao|dikha do|kholo|lagao|badlo|badal do|par jao|pe jao|per jao|ka chart|chart (do|dikhao|kholo)|chart$|ka chart dikhao)\b|(दिखाओ|खोलो|लगाओ|बदलो|चार्ट)/;
const QUESTION = /\b(what|why|how|where|when|which|is|are|should|can|could|kya|kyun|kaise|kahan|kab|kaun|kitna|batao|bata)\b|\?|क्या|क्यों|कैसे/;

export function parseVoiceCommand(textRaw: string): VoiceCommand | null {
  const t = norm(textRaw);
  if (!t) return null;
  const words = t.split(" ").length;

  // trades are never placed by voice: recognised only so PRAGYA can refuse them
  if (/^(please |pls )?(place|execute|send|buy|sell|open a|close)\b/.test(t) || /\b(order (kar|laga|bhej)|khareed(o| lo)|becho|trade (kar|laga))/.test(t)) return { kind: "order" };

  if (words <= 6 && (/\b(re-?analy[sz]e|analy[sz]e|analysis)\b|विश्लेषण|chart scan/.test(t))) return { kind: "analyze" };

  const tf = parseTimeframe(t);
  if (tf && words <= 7 && (CHANGE_VERB.test(t) || words <= 3 || /\b(chart|timeframe|time frame)\b/.test(t)) && !(QUESTION.test(t) && !CHANGE_VERB.test(t))) return { kind: "timeframe", timeframe: tf };

  if (words <= 6 && !tf) {
    const asksQuestion = QUESTION.test(t) && !CHANGE_VERB.test(t);
    if (!asksQuestion) {
      for (const [re, sym] of ALIASES) if (re.test(t)) return { kind: "symbol", phrase: sym };
      // a plain instrument id said aloud: "EURUSD", "eur usd", "US30", "show USDCAD"
      const id = /\b([a-z]{3}) ?([a-z]{3})\b/.exec(t);
      const idOne = /\b([a-z]{3,8}\d{0,3})\b/.exec(t.replace(/^(please |pls )?(show|open|switch to|change to|go to|load|chart)\s+/, ""));
      if (CHANGE_VERB.test(t) || words <= 2) {
        if (id && words <= 3) return { kind: "symbol", phrase: (id[1] + id[2]).toUpperCase() };
        if (idOne && words <= 3) return { kind: "symbol", phrase: idOne[1].toUpperCase() };
      }
    }
  }
  return null;
}

/** Finds the listed instrument a spoken phrase means: an exact symbol first, then the label or name. Never invents an instrument. */
export function resolveInstrument(phrase: string, list: readonly VoiceInstrument[]): VoiceInstrument | null {
  const p = phrase.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!p) return null;
  const exact = list.find((i) => i.symbol.toUpperCase().replace(/[^A-Z0-9]/g, "") === p);
  if (exact) return exact;
  const q = phrase.toLowerCase();
  return list.find((i) => i.label.toLowerCase() === q || i.name.toLowerCase() === q) ?? null;
}
