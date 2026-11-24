// scripts/validate-voice-commands.ts - what the trader says to PRAGYA becomes the right chart command, and questions stay questions.
// Run: npx tsx scripts/validate-voice-commands.ts
import { parseVoiceCommand, resolveInstrument, type VoiceCommand } from "../lib/chart-engine/voice-commands";

let pass = 0, fail = 0;
const show = (c: VoiceCommand | null) => (c === null ? "null" : c.kind === "timeframe" ? `tf:${c.timeframe}` : c.kind === "symbol" ? `sym:${c.phrase}` : c.kind);
const t = (said: string, want: string) => { const got = show(parseVoiceCommand(said)); if (got === want) pass++; else { fail++; console.log(`  FAIL - "${said}" -> ${got} (wanted ${want})`); } };

// timeframes
t("switch to H4", "tf:4h"); t("show me the 4 hour chart", "tf:4h"); t("daily", "tf:1d"); t("weekly chart", "tf:1w"); t("15 minute chart", "tf:15m");
t("one hour", "tf:1h"); t("chaar ghante ka chart dikhao", "tf:4h"); t("daily chart kholo", "tf:1d"); t("M5", "tf:5m"); t("go to h1", "tf:1h"); t("30 minutes", "tf:30m");
// symbols
t("show gold", "sym:XAUUSD"); t("bitcoin", "sym:BTCUSD"); t("gold chart dikhao", "sym:XAUUSD"); t("sona dikhao", "sym:XAUUSD"); t("switch to euro dollar", "sym:EURUSD");
t("EURUSD", "sym:EURUSD"); t("open US30", "sym:US30"); t("nasdaq", "sym:USTEC"); t("show usd jpy", "sym:USDJPY"); t("silver", "sym:XAGUSD");
// analysis
t("analyze the chart", "analyze"); t("analyse", "analyze"); t("chart dekho analysis karo", "analyze");
// orders are recognised only to be refused
t("buy gold now", "order"); t("place an order", "order"); t("sell bitcoin", "order"); t("order laga do", "order"); t("close the trade", "order");
// questions stay questions
t("what is the trend on gold", "null"); t("where is the entry", "null"); t("what is my risk right now", "null"); t("is bitcoin going up", "null");
t("gold ka trend kya hai", "null"); t("should I buy the dip on the daily chart", "null"); t("why is the daily trend down", "null"); t("how risky is the 4 hour setup", "null");
t("kya abhi entry sahi hai", "null"); t("tell me about the market structure and key levels on this chart", "null");

// Hindi (Devanagari) as the recogniser returns it in the Hindi mode
t("सोना दिखाओ", "sym:XAUUSD"); t("बिटकॉइन", "sym:BTCUSD"); t("चांदी का चार्ट दिखाओ", "sym:XAGUSD"); t("दैनिक चार्ट खोलो", "tf:1d"); t("चार घंटे का चार्ट दिखाओ", "tf:4h");
t("विश्लेषण करो", "analyze"); t("सोने का ट्रेंड क्या है", "null");
// questions that merely contain command words stay questions
t("what is the analysis", "null"); t("send me the key levels", "null"); t("open interest on gold", "null"); t("sell off risk on the daily chart", "null");
t("send an order", "order"); t("close the position", "order");

const list = [{ symbol: "EURUSD", label: "EUR/USD", name: "Euro vs US Dollar" }, { symbol: "XAUUSD", label: "XAU/USD", name: "Gold vs US Dollar" }, { symbol: "US30", label: "US30", name: "Dow Jones" }];
const r = (p: string) => resolveInstrument(p, list)?.symbol ?? "none";
for (const [p, want] of [["EURUSD", "EURUSD"], ["eurusd", "EURUSD"], ["XAUUSD", "XAUUSD"], ["US30", "US30"], ["ZZZUSD", "none"], ["EUR/USD", "EURUSD"]] as const) { if (r(p) === want) pass++; else { fail++; console.log(`  FAIL - resolve ${p} -> ${r(p)} (wanted ${want})`); } }

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
