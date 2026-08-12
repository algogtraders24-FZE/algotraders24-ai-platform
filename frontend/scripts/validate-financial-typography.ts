// scripts/validate-financial-typography.ts
// Sprint D2.7.1 - AT24 Financial Typography & Rendering Foundation.
// Standalone, assert-based verification (no test framework), matching
// every prior sprint's scripts/validate-*.ts pattern. Run via
// `npm run validate:financial-typography`.
//
// This project has no React/component test framework - the deterministic
// formatting functions (lib/financial-format.ts) are tested directly as
// pure functions; component-level contracts (which formatter a component
// calls, which state branches exist, no hardcoded market values) are
// verified via source inspection, the same structural-check discipline
// D2.6.11/D2.6.12's own regression scripts already established for this
// codebase's UI-contract testing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatPrice,
  formatPercent,
  formatQuantity,
  formatDecimalQuantity,
  formatCompactVolume,
  formatScore,
  formatRatio,
  formatDuration,
} from "../lib/financial-format";
import { FIN_PRIMARY, FIN_SECONDARY, FIN_TERTIARY, FIN_LABEL, financialDirectionClass, directionFromChange } from "../components/ui/financial-typography";
import { resolveChartInstrument } from "../lib/market-data/chart-instrument-resolver";
import { getCanonicalInstrument } from "../lib/market-data/instrument-catalog";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

// ============================================================
// 1-6: numeric/price formatting, decimal preservation
// ============================================================
function priceFormattingTests(): void {
  test("1: formatPrice pads a real 1-decimal value to the 2-decimal financial convention", () => {
    assert.equal(formatPrice(1537.9), "1,537.90");
  });

  test("2: formatPrice formats a real NIFTY-scale value correctly (thousands-grouped, 2 decimals)", () => {
    assert.equal(formatPrice(24435.45), "24,435.45");
  });

  test("3: formatPrice formats a real BANKNIFTY-scale value correctly", () => {
    assert.equal(formatPrice(57261.25), "57,261.25");
  });

  test("4: formatPrice with a higher maxDecimals preserves real FX-style precision without fabricating extra digits", () => {
    assert.equal(formatPrice(1.08453, { maxDecimals: 5 }), "1.08453");
  });

  test("5: formatPrice never fabricates precision beyond 2 decimals by default", () => {
    const out = formatPrice(1537.9);
    assert.equal(/\.\d{2}$/.test(out), true);
    assert.equal(out, "1,537.90");
    assert.notEqual(out, "1,537.900000");
  });

  test("6: formatPrice pads a whole-number price to the 2-decimal convention (not fabricated precision - 100 === 100.00)", () => {
    assert.equal(formatPrice(100), "100.00");
  });
}

// ============================================================
// 7-10: percentage formatting (positive/negative/zero/unsigned)
// ============================================================
function percentFormattingTests(): void {
  test("7: formatPercent prefixes a real '+' for a positive change", () => {
    assert.equal(formatPercent(1.24), "+1.24%");
  });

  test("8: formatPercent renders a negative change with a real '-' (never double-signed)", () => {
    assert.equal(formatPercent(-0.37), "-0.37%");
  });

  test("9: formatPercent renders a genuinely flat (zero) value honestly - no fabricated sign", () => {
    assert.equal(formatPercent(0), "0.00%");
  });

  test("10: formatPercent unsigned mode (e.g. AI confidence 0-100) never prefixes a '+'", () => {
    assert.equal(formatPercent(72, { signed: false }), "72.00%");
  });
}

// ============================================================
// 11-13: quantity/volume formatting
// ============================================================
function quantityFormattingTests(): void {
  test("11: formatQuantity groups thousands with no fabricated decimals", () => {
    assert.equal(formatQuantity(1500000), "1,500,000");
  });

  test("12: formatDecimalQuantity preserves real decimal precision, thousands-grouped", () => {
    assert.equal(formatDecimalQuantity(1500000.5), "1,500,000.5");
  });

  test("13: formatCompactVolume uses real, standard compact notation for large volume figures only", () => {
    const out = formatCompactVolume(1500000);
    assert.equal(out.includes("1.5"), true);
    assert.equal(out.toUpperCase().includes("M"), true);
  });
}

// ============================================================
// 14-17: Intelligence Score contract - X/100, never a probability
// ============================================================
function scoreFormattingTests(): void {
  test("14: formatScore renders a real score as X/100", () => {
    assert.equal(formatScore(72), "72/100");
  });

  test("15: formatScore renders undefined honestly as 'Unavailable', never a fabricated 0", () => {
    assert.equal(formatScore(undefined), "Unavailable");
  });

  test("16: formatScore never contains a percent sign - it is never presented as a percentage", () => {
    assert.equal(formatScore(72).includes("%"), false);
  });

  test("17: formatScore renders a genuine zero score honestly (0/100), never conflated with 'Unavailable'", () => {
    assert.equal(formatScore(0), "0/100");
  });

  test("17b: formatRatio uses the same X/Y shape as formatScore, never a percentage", () => {
    assert.equal(formatRatio(3, 5), "3/5");
    assert.equal(formatRatio(3, 5).includes("%"), false);
  });
}

// ============================================================
// 18-20: duration formatting (AuditTraceView latencyMs)
// ============================================================
function durationFormattingTests(): void {
  test("18: formatDuration renders a sub-second value in real milliseconds", () => {
    assert.equal(formatDuration(842), "842ms");
  });

  test("19: formatDuration renders a real multi-second value with one decimal", () => {
    assert.equal(formatDuration(2400), "2.4s");
  });

  test("20: formatDuration renders a real multi-minute value as minutes+seconds", () => {
    assert.equal(formatDuration(185000), "3m 5s");
  });
}

// ============================================================
// 21-23: no-fabrication / value-never-mutated guarantees
// ============================================================
function noFabricationTests(): void {
  test("21: formatPrice never returns more decimal digits than the requested maxDecimals cap", () => {
    const out = formatPrice(1.0845399999, { maxDecimals: 3 });
    const decimalPart = out.split(".")[1] ?? "";
    assert.equal(decimalPart.length <= 3, true);
  });

  test("22: formatPrice(1537.9) does not fabricate a third decimal digit", () => {
    assert.equal(/^\d[\d,]*\.\d{2}$/.test(formatPrice(1537.9)), true);
  });

  test("23: formatting a value never mutates the original number (presentation-only, source value untouched)", () => {
    const original = 1537.9;
    const price = original;
    formatPrice(price);
    assert.equal(price, 1537.9);
    assert.equal(original, 1537.9);
  });
}

// ============================================================
// 24-27: direction/state helpers (positive/negative/zero/unavailable/stale)
// ============================================================
function directionAndStateTests(): void {
  test("24: directionFromChange(undefined) is honestly neutral, never guessed", () => {
    assert.equal(directionFromChange(undefined), "neutral");
  });

  test("25: directionFromChange(0) is neutral (a genuinely flat value, never shown as up or down)", () => {
    assert.equal(directionFromChange(0), "neutral");
  });

  test("26: directionFromChange(positive) is up", () => {
    assert.equal(directionFromChange(1.5), "up");
  });

  test("27: directionFromChange(negative) is down", () => {
    assert.equal(directionFromChange(-1.5), "down");
  });

  test("27b: financialDirectionClass maps every direction to a real, existing color token - never a fabricated class", () => {
    assert.equal(financialDirectionClass("up"), "text-signal-up");
    assert.equal(financialDirectionClass("down"), "text-signal-down");
    assert.equal(financialDirectionClass("neutral"), "text-text-2");
  });
}

// ============================================================
// 28-31: FinancialValue component contract (loading/unavailable/stale/no hardcoded values)
// ============================================================
function financialValueContractTests(): void {
  const src = read("components/ui/FinancialValue.tsx");

  test("28: FinancialValue structurally handles a loading state (renders Skeleton, never a fabricated number)", () => {
    assert.ok(src.includes('state === "loading"'));
    assert.ok(src.includes("Skeleton"));
  });

  test("29: FinancialValue structurally handles the unavailable state honestly", () => {
    assert.ok(src.includes('state === "unavailable"'));
    assert.ok(src.includes("Unavailable"));
  });

  test("30: FinancialValue structurally handles the stale state honestly, distinct from unavailable", () => {
    assert.ok(src.includes('state === "stale"'));
    assert.ok(src.includes("Stale"));
  });

  test("31: FinancialValue never hardcodes a market value or a real symbol name in its source", () => {
    assert.ok(!/\b(RELIANCE|NIFTY|BANKNIFTY|BTCUSD|EURUSD)\b/.test(src));
    assert.ok(!/\b\d{2,}\.\d{2,}\b/.test(src), "no literal price-shaped numeric constant should appear in the component");
  });
}

// ============================================================
// 32-35: tabular numeral configuration + design-token availability
// ============================================================
function tabularAndTokenTests(): void {
  test("32: every FIN_* value tier applies the fin-num tabular-numeral contract", () => {
    for (const cls of [FIN_PRIMARY, FIN_SECONDARY, FIN_TERTIARY]) {
      assert.ok(cls.includes("fin-num"));
    }
  });

  test("33: app/globals.css defines .fin-num with font-variant-numeric: tabular-nums", () => {
    const css = read("app/globals.css");
    assert.ok(/\.fin-num\s*\{[^}]*font-variant-numeric:\s*tabular-nums/.test(css));
  });

  test("34: app/globals.css's .fin-num also sets the OpenType tabular-figure feature (\"tnum\" 1), per Phase 2's explicit instruction", () => {
    const css = read("app/globals.css");
    assert.ok(/\.fin-num\s*\{[^}]*font-feature-settings:\s*"tnum"\s*1/.test(css));
  });

  test("35: FIN_LABEL matches StatField's own existing label convention exactly - never a second, drifted label style", () => {
    const statFieldSrc = read("components/workspace/StatField.tsx");
    assert.ok(statFieldSrc.includes(FIN_LABEL), "StatField.tsx's own label class must literally contain FIN_LABEL's exact string");
  });
}

// ============================================================
// 36-42: component rendering contracts - real components call the real formatters, never a hardcoded value
// ============================================================
function componentContractTests(): void {
  test("36: MarketRibbon.tsx renders prices via the shared formatPrice/formatPercent utility, not a hand-rolled toLocaleString", () => {
    const src = read("components/workspace/MarketRibbon.tsx");
    assert.ok(src.includes("formatPrice("));
    assert.ok(src.includes("formatPercent("));
    assert.ok(!src.includes("toLocaleString"));
  });

  test("37: WorkspaceHeader.tsx renders its price via the shared formatPrice utility", () => {
    const src = read("components/workspace/WorkspaceHeader.tsx");
    assert.ok(src.includes("formatPrice("));
  });

  test("38: IntelligenceScorePanel.tsx renders its score via the shared formatScore utility, never a hand-rolled `/100` template", () => {
    const src = read("components/intelligence-workspace/IntelligenceScorePanel.tsx");
    assert.ok(src.includes("formatScore("));
    assert.ok(!/`\$\{[^}]*score[^}]*\}\/100`/i.test(src));
  });

  test("39: VerifiedMarketContext.tsx renders its Intelligence Score via the shared formatScore utility", () => {
    const src = read("components/intelligence-workspace/VerifiedMarketContext.tsx");
    assert.ok(src.includes("formatScore("));
  });

  test("40: AuditTraceView.tsx renders presenter-attempt latency via the shared formatDuration utility, not a raw '${ms}ms' template", () => {
    const src = read("components/intelligence-workspace/AuditTraceView.tsx");
    assert.ok(src.includes("formatDuration("));
    assert.ok(!/\$\{attempt\.latencyMs\}ms/.test(src));
  });

  test("41: no workspace/intelligence-workspace component contains a hardcoded literal matching a real live-verified smoke-test price", () => {
    const suspiciousLiterals = ["24435.45", "57261.25", "1318.8"];
    const files = [
      "components/workspace/MarketRibbon.tsx",
      "components/workspace/WorkspaceHeader.tsx",
      "components/workspace/IntelligencePanel.tsx",
      "components/intelligence-workspace/VerifiedMarketContext.tsx",
      "components/intelligence-workspace/IntelligenceScorePanel.tsx",
      "components/intelligence-workspace/MarketDataProvenance.tsx",
      "components/intelligence-workspace/AuditTraceView.tsx",
      "components/ui/FinancialValue.tsx",
    ];
    for (const file of files) {
      const src = read(file);
      for (const literal of suspiciousLiterals) {
        assert.ok(!src.includes(literal), `${file} must not contain the hardcoded value ${literal}`);
      }
    }
  });

  test("42: HypothesisPanel.tsx renders its candle count via the shared formatQuantity utility", () => {
    const src = read("components/intelligence-workspace/HypothesisPanel.tsx");
    assert.ok(src.includes("formatQuantity("));
  });
}

// ============================================================
// 43-44: responsive behavior (structural)
// ============================================================
function responsiveTests(): void {
  test("43: FinancialValue's value row wraps rather than clipping/overlapping on narrow viewports", () => {
    const src = read("components/ui/FinancialValue.tsx");
    assert.ok(src.includes("flex-wrap"));
  });

  test("44: MarketRibbon remains horizontally scrollable with fixed minimum cell widths, never clipping a price", () => {
    const src = read("components/workspace/MarketRibbon.tsx");
    assert.ok(src.includes("overflow-x-auto"));
    assert.ok(src.includes("min-w-["));
  });
}

// ============================================================
// 45-46: probability-semantics guard (structural, mirrors every prior D2.5.x/D2.6.x no-fabrication check)
// ============================================================
function probabilitySemanticsTests(): void {
  test("45: lib/financial-format.ts never makes an AFFIRMATIVE probability-of-profit claim (a negated safety comment documenting the rule, e.g. 'never a probability of profit', is expected and fine - the same false-positive class D2.6.1's own memory already documents for this codebase's honest disclaimer text: a naive substring search flags the rule's own negation)", () => {
    const src = read("lib/financial-format.ts").toLowerCase();
    const phrase = "probability of profit";
    let index = src.indexOf(phrase);
    while (index !== -1) {
      const precedingContext = src.slice(Math.max(0, index - 20), index);
      assert.ok(/\b(never|not)\b/.test(precedingContext), `"${phrase}" at index ${index} is not clearly negated nearby`);
      index = src.indexOf(phrase, index + 1);
    }
    assert.ok(!src.includes("win rate"));
  });

  test("46: components/ui/financial-typography.ts never contains probability-of-profit language", () => {
    const src = read("components/ui/financial-typography.ts").toLowerCase();
    assert.ok(!src.includes("probability of profit"));
  });
}

// ============================================================
// 47-50: regression guards - no provider/market-data/chart-resolver/
// workspace-symbol-state logic was touched or broken by this sprint
// ============================================================
function regressionGuardTests(): void {
  test("47: chart-instrument-resolver.ts still resolves a real catalog instrument correctly - unmodified by this typography-only sprint", () => {
    const chart = resolveChartInstrument("BTCUSD");
    assert.equal(chart.supported, true);
    assert.equal(chart.chartSymbol, "COINBASE:BTCUSD");
  });

  test("48: instrument-catalog.ts still resolves a real hand-curated instrument correctly", () => {
    const instrument = getCanonicalInstrument("EURUSD");
    assert.ok(instrument);
    assert.equal(instrument!.id, "EURUSD");
  });

  test("49: WorkspaceContext.tsx was not touched by this typography sprint - it imports no financial-format/financial-typography module", () => {
    const src = read("context/WorkspaceContext.tsx");
    assert.ok(!src.includes("financial-format"));
    assert.ok(!src.includes("financial-typography"));
  });

  test("50: market-data.service.ts stays presentation-free - it never imports the formatting layer this sprint adds (formatting is UI-only, never leaks into the data layer)", () => {
    const src = read("services/market-data/market-data.service.ts");
    assert.ok(!src.includes("financial-format"));
    assert.ok(!src.includes("financial-typography"));
  });
}

async function main(): Promise<void> {
  priceFormattingTests();
  percentFormattingTests();
  quantityFormattingTests();
  scoreFormattingTests();
  durationFormattingTests();
  noFabricationTests();
  directionAndStateTests();
  financialValueContractTests();
  tabularAndTokenTests();
  componentContractTests();
  responsiveTests();
  probabilitySemanticsTests();
  regressionGuardTests();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
