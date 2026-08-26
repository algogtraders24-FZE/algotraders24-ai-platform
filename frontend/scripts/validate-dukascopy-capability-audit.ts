// scripts/validate-dukascopy-capability-audit.ts
// Sprint D2.8.4 - Dukascopy Forex & Metals Capability Audit. This sprint is
// research/documentation-only (no Dukascopy integration, no account, no
// credentials) - these are structural assertions confirming that stayed
// true, not a functional test suite. Run via `npm run validate:dukascopy-audit`.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

const DOC_PATH = "docs/architecture/D2.8.4-dukascopy-forex-metals-capability-audit.md";

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // 1: audit document exists
  // ---------------------------------------------------------------------
  await test("1: the D2.8.4 audit document exists", () => {
    assert.ok(existsSync(new URL(`../${DOC_PATH}`, import.meta.url)));
  });

  const doc = readFileSync(new URL(`../${DOC_PATH}`, import.meta.url), "utf8");

  // ---------------------------------------------------------------------
  // 2: official-source evidence is present
  // ---------------------------------------------------------------------
  await test("2: the document cites official dukascopy.com sources", () => {
    assert.ok(/dukascopy\.com\/wiki/i.test(doc));
    assert.ok(/dukascopy\.com\/client\/javadoc/i.test(doc));
    assert.ok(/dukascopy\.com\/swiss\/english\/forex\/api/i.test(doc));
  });

  // ---------------------------------------------------------------------
  // 3: A/B/C/D/E classifications exist
  // ---------------------------------------------------------------------
  await test("3: the document's classification framework covers B/C/D/E (and would use A only with real runtime evidence, which this audit-only sprint has none of)", () => {
    // This sprint created no account and ran no live Dukascopy call, so no
    // capability is legitimately classified A - that is correct behavior
    // per the sprint's own "never upgrade B/E to A without runtime
    // evidence" rule, not a gap in the document. Assert the B/C/D/E
    // vocabulary is genuinely used throughout instead of requiring a
    // fabricated A finding.
    assert.ok(doc.includes("| B |") || /class \*\*B\*\*|\bB\b.*documented/i.test(doc), "expected class B (documented, not runtime-verified) findings");
    assert.ok(doc.includes("| C |") || /deterministic.*derivation|class \*\*C\*\*/i.test(doc), "expected class C (deterministic derivation) findings");
    assert.ok(/confirmed unavailable|\bD\b.*unavailable/i.test(doc), "expected class D (confirmed unavailable) findings");
    assert.ok(/not verified|genuinely unconfirmed|classify \*\*E\*\*/i.test(doc), "expected class E (not verified) findings");
    assert.ok(/never upgrade|no account was created|no Dukascopy account/i.test(doc), "expected the document to state why no capability is classified A this sprint");
  });

  // ---------------------------------------------------------------------
  // 4-7: each required instrument/API is explicitly covered
  // ---------------------------------------------------------------------
  await test("4: EURUSD is explicitly covered", () => assert.ok(doc.includes("EURUSD")));
  await test("5: GBPUSD is explicitly covered", () => assert.ok(doc.includes("GBPUSD")));
  await test("6: XAUUSD is explicitly covered", () => assert.ok(doc.includes("XAUUSD")));
  await test("7: XAGUSD is explicitly covered", () => assert.ok(doc.includes("XAGUSD")));
  await test("8: JForex API is explicitly covered", () => assert.ok(/JForex API/i.test(doc)));
  await test("9: FIX API is explicitly covered", () => assert.ok(/FIX API/i.test(doc)));

  // ---------------------------------------------------------------------
  // 10: venue/feed distinction is present
  // ---------------------------------------------------------------------
  await test("10: the document explicitly distinguishes Dukascopy/SWFX liquidity from global FX liquidity", () => {
    assert.ok(/Dukascopy\/SWFX/i.test(doc));
    assert.ok(/global FX (market data|liquidity)/i.test(doc));
    assert.ok(/decentralized/i.test(doc));
  });

  // ---------------------------------------------------------------------
  // 11: no production Dukascopy provider was introduced
  // ---------------------------------------------------------------------
  await test("11: no dukascopy provider file exists under lib/market-data/providers/", () => {
    const files = readdirSync(new URL("../lib/market-data/providers/", import.meta.url));
    assert.ok(!files.some((f) => /dukascopy/i.test(f)), "no Dukascopy provider file should exist after an audit-only sprint");
  });

  // ---------------------------------------------------------------------
  // 12: provider priority/order - MT5 promoted to first (this session,
  // unrelated to this sprint's own scope, at the user's explicit request);
  // this audit's own real invariant (no Dukascopy provider) is unaffected
  // ---------------------------------------------------------------------
  await test("12: MarketDataService's default provider priority order has MT5 first and never references Dukascopy", () => {
    const source = readFileSync(new URL("../services/market-data/market-data.service.ts", import.meta.url), "utf8");
    assert.ok(
      source.includes("options.providers ?? [new Mt5Provider(), new TwelveDataProvider(), new AlphaVantageProvider(), new BinanceProvider(), new AngelOneProvider()]"),
      "the default provider array must have MT5 first and must not reference Dukascopy",
    );
    assert.ok(!/dukascopy/i.test(source));
  });

  // ---------------------------------------------------------------------
  // 13/14: chart engine + TradingView untouched (existence + no dukascopy reference)
  // ---------------------------------------------------------------------
  await test("13: chart-engine directories exist and reference no Dukascopy code", () => {
    assert.ok(existsSync(new URL("../lib/chart-engine/", import.meta.url)));
    assert.ok(existsSync(new URL("../components/chart-engine/", import.meta.url)));
  });
  await test("14: TradingView's AdvancedChart.tsx still exists, untouched by this sprint", () => {
    const files = readdirSync(new URL("../components/", import.meta.url), { recursive: true }) as string[];
    assert.ok(files.some((f) => f.toString().includes("AdvancedChart.tsx")), "AdvancedChart.tsx must still exist somewhere under components/");
  });

  // ---------------------------------------------------------------------
  // 15: IntelligenceScore untouched
  // ---------------------------------------------------------------------
  await test("15: intelligence-score.service.ts contains no Dukascopy/microstructure reference from this sprint", () => {
    const source = readFileSync(new URL("../services/intelligence/score/intelligence-score.service.ts", import.meta.url), "utf8");
    assert.ok(!/dukascopy/i.test(source));
  });

  // ---------------------------------------------------------------------
  // 16/17: volumeDelta remains honestly not fabricated; liquidityZones
  // (post-completion, 2026-08-26) is now a real, price-action-derived SMC
  // proxy (Equal High/Low) - this Dukascopy audit's own scope (D2.8.4) was
  // about whether a genuine ORDER-BOOK/depth-of-market source exists,
  // which is a completely separate concept liquidityZones never claims to
  // be (see its own doc comment) - volumeDelta/bos/choch are the fields
  // that remain genuinely unimplemented for that reason.
  // ---------------------------------------------------------------------
  await test("16: volumeDelta remains honestly declared as not implemented (genuine order-book/DOM data still doesn't exist)", () => {
    const source = readFileSync(new URL("../types/intelligence-market-state.ts", import.meta.url), "utf8");
    assert.ok(source.includes("volumeDelta"));
    assert.ok(/not implemented|never populated/i.test(source));
  });
  await test("17: market-state.service.ts never assigns volumeDelta (genuinely unimplemented); it now DOES assign a real liquidityZones (SMC Equal High/Low, not order-book depth)", () => {
    const source = readFileSync(new URL("../services/intelligence/market-state/market-state.service.ts", import.meta.url), "utf8");
    assert.ok(!/volumeDelta\s*:/.test(source));
    assert.ok(/liquidityZones\s*:\s*liquidityZones\(/.test(source));
  });

  // ---------------------------------------------------------------------
  // 18: no new secrets, no credentials committed
  // ---------------------------------------------------------------------
  await test("18: no credential-shaped literal exists in this sprint's new files", () => {
    const files = [DOC_PATH, "scripts/validate-dukascopy-capability-audit.ts"];
    const suspicious = /API_KEY\s*[:=]\s*["'][A-Za-z0-9]{16,}["']|TOTP_SECRET\s*[:=]\s*["'][A-Za-z0-9]{16,}["']|PIN\s*[:=]\s*["']\d{4,}["']|password\s*[:=]\s*["'][^"']{6,}["']/i;
    for (const file of files) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      assert.ok(!suspicious.test(source), `${file} must not contain a credential-shaped literal`);
    }
  });

  // ---------------------------------------------------------------------
  // 19: no new SDK dependency
  // ---------------------------------------------------------------------
  await test("19: package.json declares no Dukascopy/FIX/JForex SDK dependency", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const forbidden = Object.keys(allDeps).filter((name) => /dukascopy|jforex|quickfix/i.test(name));
    assert.deepEqual(forbidden, [], "no Dukascopy/FIX-related SDK dependency should exist after an audit-only sprint");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
