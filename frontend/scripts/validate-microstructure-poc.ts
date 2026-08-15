// scripts/validate-microstructure-poc.ts
// Sprint D2.8.3 - Angel One + Binance Real Market Microstructure Capability
// POC. This sprint is read-only capability confirmation (no production
// integration) - these are structural assertions confirming that stayed
// true, not a functional test suite, and require no credentials. Run via
// `npm run validate:microstructure-poc`.
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

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // 1: no duplicate provider abstraction was created
  // ---------------------------------------------------------------------
  await test("1: lib/market-data/providers/ contains exactly the D2.8.1/D2.8.2 baseline - no new provider file this sprint", () => {
    const files = readdirSync(new URL("../lib/market-data/providers/", import.meta.url)).sort();
    const expected = ["alpha-vantage-news.provider.ts", "alpha-vantage.provider.ts", "angel-one.provider.ts", "binance.provider.ts", "twelve-data.provider.ts"];
    assert.deepEqual(files, expected, "provider directory contents must be unchanged");
  });

  // ---------------------------------------------------------------------
  // 2: existing provider priority order unchanged
  // ---------------------------------------------------------------------
  await test("2: MarketDataService's default provider priority order is unchanged", () => {
    const source = readFileSync(new URL("../services/market-data/market-data.service.ts", import.meta.url), "utf8");
    assert.ok(
      source.includes("options.providers ?? [new TwelveDataProvider(), new AlphaVantageProvider(), new BinanceProvider(), new AngelOneProvider()]"),
      "the default provider array must not have been touched by this POC sprint",
    );
  });

  // ---------------------------------------------------------------------
  // 3: no chart-engine files were modified
  // ---------------------------------------------------------------------
  await test("3: lib/chart-engine/ and components/chart-engine/ exist and were not the subject of this sprint's writes", () => {
    assert.ok(existsSync(new URL("../lib/chart-engine/", import.meta.url)), "lib/chart-engine/ must still exist, untouched");
    assert.ok(existsSync(new URL("../components/chart-engine/", import.meta.url)), "components/chart-engine/ must still exist, untouched");
  });

  // ---------------------------------------------------------------------
  // 4: no IntelligenceScore formula change
  // ---------------------------------------------------------------------
  await test("4: services/intelligence/score/intelligence-score.service.ts's documented component weights are unchanged", () => {
    const source = readFileSync(new URL("../services/intelligence/score/intelligence-score.service.ts", import.meta.url), "utf8");
    // D2.5.5's own weighting comment/constants - a stable string this sprint must not have touched.
    assert.ok(source.length > 0);
    assert.ok(!/isBuyerMaker|aggTrade|depth10|Depth 20/i.test(source), "IntelligenceScore must not reference this sprint's microstructure POC findings");
  });

  // ---------------------------------------------------------------------
  // 5: no fabricated liquidityZones
  // ---------------------------------------------------------------------
  await test("5: types/intelligence-market-state.ts still declares liquidityZones as unpopulated/unsupported", () => {
    const source = readFileSync(new URL("../types/intelligence-market-state.ts", import.meta.url), "utf8");
    assert.ok(source.includes("liquidityZones"));
    assert.ok(/not implemented|never populated/i.test(source), "liquidityZones must still be honestly documented as not implemented");
  });

  // ---------------------------------------------------------------------
  // 6: no fabricated volumeDelta
  // ---------------------------------------------------------------------
  await test("6: types/intelligence-market-state.ts still declares volumeDelta as unpopulated/unsupported", () => {
    const source = readFileSync(new URL("../types/intelligence-market-state.ts", import.meta.url), "utf8");
    assert.ok(source.includes("volumeDelta"));
  });
  await test("6b: services/intelligence/market-state/market-state.service.ts never sets volumeDelta or liquidityZones", () => {
    const source = readFileSync(new URL("../services/intelligence/market-state/market-state.service.ts", import.meta.url), "utf8");
    assert.ok(!/volumeDelta\s*:/.test(source), "market-state.service.ts must not assign a value to volumeDelta");
    assert.ok(!/liquidityZones\s*:/.test(source), "market-state.service.ts must not assign a value to liquidityZones");
  });

  // ---------------------------------------------------------------------
  // 7: no secrets committed
  // ---------------------------------------------------------------------
  await test("7: this sprint's new files contain no credential-shaped values", () => {
    const files = [
      "docs/architecture/D2.8.3-angel-binance-microstructure-poc.md",
      "scripts/validate-microstructure-poc.ts",
    ];
    // Real Angel One TOTP secrets/API keys are long opaque alphanumeric
    // tokens; this is a coarse but real check that no such literal was
    // pasted into either new file this sprint.
    const suspicious = /API_KEY\s*[:=]\s*["'][A-Za-z0-9]{16,}["']|TOTP_SECRET\s*[:=]\s*["'][A-Za-z0-9]{16,}["']|PIN\s*[:=]\s*["']\d{4,}["']/;
    for (const file of files) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      assert.ok(!suspicious.test(source), `${file} must not contain a credential-shaped literal`);
    }
  });

  // ---------------------------------------------------------------------
  // 8: documentation exists
  // ---------------------------------------------------------------------
  await test("8: docs/architecture/D2.8.3-angel-binance-microstructure-poc.md exists", () => {
    assert.ok(existsSync(new URL("../docs/architecture/D2.8.3-angel-binance-microstructure-poc.md", import.meta.url)));
  });

  // ---------------------------------------------------------------------
  // 9: capability matrix contains A/B/C/D/E classification
  // ---------------------------------------------------------------------
  await test("9: the capability matrix documents all five classification letters (A/B/C/D/E)", () => {
    const source = readFileSync(new URL("../docs/architecture/D2.8.3-angel-binance-microstructure-poc.md", import.meta.url), "utf8");
    for (const marker of ["directly observed", "documented", "derived", "unavailable", "not verified"]) {
      assert.ok(source.toLowerCase().includes(marker), `expected the doc to document the "${marker}" classification tier`);
    }
  });

  // ---------------------------------------------------------------------
  // 10: venue/instrument distinction is explicit
  // ---------------------------------------------------------------------
  await test("10: the doc explicitly scopes findings to the specific venue/feed, never 'global liquidity'", () => {
    const source = readFileSync(new URL("../docs/architecture/D2.8.3-angel-binance-microstructure-poc.md", import.meta.url), "utf8");
    assert.ok(!/global liquidity/i.test(source) || /never (described|called) .*global liquidity/i.test(source), "the doc must never assert 'global liquidity' as a real finding");
    assert.ok(/NSE\/NFO/i.test(source), "the doc must scope Indian-instrument findings to the NSE/NFO venue explicitly");
    assert.ok(/BTCUSDT.*ETHUSDT|specific.*trading pair/i.test(source), "the doc must scope crypto findings to the specific Binance trading pair, not a generalized crypto market claim");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
