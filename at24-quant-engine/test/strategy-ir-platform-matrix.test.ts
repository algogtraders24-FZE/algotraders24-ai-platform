import { test } from "node:test";
import assert from "node:assert/strict";
import { PLATFORM_SEMANTIC_MATRIX, getPlatformProfile } from "../src/domain/strategy-ir/platform-matrix.js";

const ALL_PLATFORMS = ["MT4_MQL4", "MT5_MQL5", "TRADINGVIEW_PINE", "NINJATRADER_NINJASCRIPT", "CTRADER_CBOT", "AT24_NATIVE"] as const;

test("Q0.7.40: the platform matrix has exactly one row per non-reserved SourcePlatform (AI_GENERATED/UNKNOWN excluded — they have no platform-native semantics to catalog)", () => {
  const platforms = PLATFORM_SEMANTIC_MATRIX.map((p) => p.platform);
  assert.equal(new Set(platforms).size, platforms.length);
  for (const p of ALL_PLATFORMS) assert.ok(platforms.includes(p), `matrix must cover ${p}`);
});

test("every matrix row has every required dimension populated with a non-empty string", () => {
  const dimensions = ["accountMode", "orderModel", "positionModel", "barTiming", "mtf", "repainting", "slTp", "trailing", "partialClose", "sessions", "timezone", "fees", "spread", "slippage", "intrabar", "historicalRealtime"] as const;
  for (const profile of PLATFORM_SEMANTIC_MATRIX) {
    for (const dim of dimensions) {
      assert.ok((profile[dim] as string).trim().length > 0, `${profile.platform}.${dim} must not be empty`);
    }
  }
});

test("getPlatformProfile returns the matching profile, or undefined for AI_GENERATED (not a native platform)", () => {
  assert.equal(getPlatformProfile("MT4_MQL4")?.platform, "MT4_MQL4");
  assert.equal(getPlatformProfile("AI_GENERATED"), undefined);
});

test("MT4 is hedging-only, MT5/cTrader support both modes explicitly, AT24 native is netting-only — real, cited platform facts (docs/Q0.4_PLATFORM_DECISIONS.md)", () => {
  assert.match(getPlatformProfile("MT4_MQL4")!.accountMode, /[Hh]edging only/);
  assert.match(getPlatformProfile("MT5_MQL5")!.accountMode, /netting.*OR.*hedging|hedging.*OR.*netting/i);
  assert.match(getPlatformProfile("CTRADER_CBOT")!.accountMode, /[Bb]oth netting and hedging/);
  assert.match(getPlatformProfile("AT24_NATIVE")!.accountMode, /NETTING only/);
});
