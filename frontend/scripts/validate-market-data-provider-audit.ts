// scripts/validate-market-data-provider-audit.ts
// Sprint D2.8.2 - Market Microstructure Provider Capability Audit. This
// sprint is research/documentation-only (no dxFeed/Databento/new-provider
// integration, no production architecture change) - these are pure
// structural assertions confirming that stayed true, not a functional test
// suite. Run via `npm run validate:market-data-provider-audit`.
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
  // 1: no new provider adapter files were added
  // ---------------------------------------------------------------------
  await test("1: lib/market-data/providers/ contains exactly the D2.8.1 baseline plus the intentional MT5 bridge addition - no dxFeed/Databento/other stray adapter files", () => {
    const files = readdirSync(new URL("../lib/market-data/providers/", import.meta.url)).sort();
    // Updated for the MT5 (Exness) live data bridge - a legitimate new
    // provider file, same as angel-one.provider.ts/binance.provider.ts
    // were legitimate additions after this test was first written. The
    // invariant this test protects is "no STRAY/unexpected file appears",
    // not "the file count is frozen forever".
    const expected = ["alpha-vantage-news.provider.ts", "alpha-vantage.provider.ts", "angel-one.provider.ts", "binance.provider.ts", "mt5.provider.ts", "twelve-data.provider.ts"];
    assert.deepEqual(files, expected, "provider directory contents must be unchanged from D2.8.1 plus the intentional MT5 bridge addition");
  });

  // ---------------------------------------------------------------------
  // 2: MarketDataService's default provider array is unchanged
  // ---------------------------------------------------------------------
  await test("2: MarketDataService's default provider priority order for the D2.8.1 providers is unchanged (Twelve Data, Alpha Vantage, Binance, Angel One, in that exact order) - MT5 is a legitimate APPEND after them, never inserted before", () => {
    const source = readFileSync(new URL("../services/market-data/market-data.service.ts", import.meta.url), "utf8");
    assert.ok(
      source.includes("options.providers ?? [new TwelveDataProvider(), new AlphaVantageProvider(), new BinanceProvider(), new AngelOneProvider(), new Mt5Provider()]"),
      "the D2.8.1 providers must keep their exact original relative order, with MT5 appended last",
    );
  });

  // ---------------------------------------------------------------------
  // 3: no new environment variable names were introduced
  // ---------------------------------------------------------------------
  await test("3: lib/market-data/env.ts reads exactly the same environment variable names as D2.8.1 - no new provider credentials", () => {
    const source = readFileSync(new URL("../lib/market-data/env.ts", import.meta.url), "utf8");
    const expectedVars = ["ALPHA_VANTAGE_API_KEY", "TWELVEDATA_API_KEY", "API_KEY", "CLIENT_CODE", "PIN", "TOTP_SECRET"];
    for (const v of expectedVars) {
      assert.ok(source.includes(`process.env.${v}`), `expected existing env var ${v} to still be read`);
    }
    const forbiddenNewVendors = ["DXFEED", "DATABENTO"];
    for (const v of forbiddenNewVendors) {
      assert.ok(!source.includes(v), `env.ts must not reference a new vendor (${v}) - this sprint adds no credentials`);
    }
  });

  // ---------------------------------------------------------------------
  // 4: the dead fabrication chain D2.8.1 removed remains removed
  // ---------------------------------------------------------------------
  await test("4: the D2.8.1-deleted fabricated liquidity-analysis chain remains deleted", () => {
    assert.equal(existsSync(new URL("../services/ai/trading/liquidity-analysis.service.ts", import.meta.url)), false);
    assert.equal(existsSync(new URL("../services/ai/trading/market-analysis.service.ts", import.meta.url)), false);
  });

  // ---------------------------------------------------------------------
  // 5: the real risk engine still reports liquidity/execution risk honestly
  // ---------------------------------------------------------------------
  await test("5: services/ai/risk/risk-engine.service.ts still reports liquidity/execution risk as honestly unmeasured (medium, empty basis)", () => {
    const source = readFileSync(new URL("../services/ai/risk/risk-engine.service.ts", import.meta.url), "utf8");
    assert.ok(source.includes('category: "liquidity"'));
    assert.ok(source.includes('category: "execution"') || source.includes("assessExecutionRisk"));
    assert.ok(/no evidence source for liquidity exists/i.test(source), "liquidity risk rationale must still state no evidence source exists");
  });

  // ---------------------------------------------------------------------
  // 6: no new dependency/SDK was added for a microstructure vendor
  // ---------------------------------------------------------------------
  await test("6: package.json declares no dxFeed/Databento SDK dependency", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const forbidden = Object.keys(allDeps).filter((name) => /dxfeed|databento/i.test(name));
    assert.deepEqual(forbidden, [], "no microstructure-vendor SDK dependency should exist after an audit-only sprint");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
