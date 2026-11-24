// scripts/validate-voice-wake.ts - the "Hey PRAGYA" wake phrase: found at the start of a sentence, the rest becomes the command.
// Run: npx tsx scripts/validate-voice-wake.ts
import { extractWake } from "../lib/chart-engine/voice-wake";

let pass = 0, fail = 0;
const t = (said: string, woke: boolean, rest: string) => {
  const r = extractWake(said);
  if (r.woke === woke && r.rest === rest) pass++;
  else { fail++; console.log(`  FAIL - "${said}" -> woke=${r.woke} rest="${r.rest}" (wanted woke=${woke} rest="${rest}")`); }
};

// wakes, with and without a command
t("hey pragya", true, "");
t("Hey Pragya.", true, "");
t("hey pragya show gold", true, "show gold");
t("Hey Pragya, what is the trend", true, "what is the trend");
t("ok pragya analyze the chart", true, "analyze the chart");
t("hello pragya 4 hour chart", true, "4 hour chart");
t("hi pragya please show bitcoin", true, "show bitcoin");
// the many spellings of the name
t("hey pragna show gold", true, "show gold");
t("hey prajna", true, "");
t("hey praggya what is my risk", true, "what is my risk");
t("hey pragyaa", true, "");
// Hindi / Devanagari
t("हे प्रज्ञा सोना दिखाओ", true, "सोना दिखाओ");
t("हे प्रज्ञा", true, "");
t("ओके प्रज्ञा विश्लेषण करो", true, "विश्लेषण करो");
// bare name at the very start of a command works too
t("pragya show gold", true, "show gold");
t("pragya", true, "");
// no wake: the name in the middle, other words, nothing
t("ask pragya about gold", false, "");
t("what does pragya think", false, "");
t("show gold", false, "");
t("hey siri show gold", false, "");
t("pragyaan is a word", false, "");
t("", false, "");
t("hey", false, "");

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
