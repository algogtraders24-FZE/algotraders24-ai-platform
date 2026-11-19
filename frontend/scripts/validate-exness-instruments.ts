// scripts/validate-exness-instruments.ts
// No network: fetch is injected. Checks the Exness instrument list (several response shapes), grouping, labels and the canonical entry.
// Run: npx tsx scripts/validate-exness-instruments.ts
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { ExnessApiClient, ExnessApiError, type ExnessFetch } from "../lib/market-data/exness-api";
import { buildExnessCanonical, classifyExnessSymbol, labelForSymbol, toExnessDto } from "../lib/market-data/exness-instrument-model";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); } catch (e) { failed++; console.error(`  FAIL - ${name}\n    ${e instanceof Error ? e.message : String(e)}`); }
}

const pair = generateKeyPairSync("ed25519");
const der = pair.privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;
const seed = der.subarray(der.length - 32);
const pubRaw = (pair.publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32);
const ENV = { apiKey: "k", privateKey: Buffer.concat([seed, pubRaw]).toString("hex"), accountId: "123", gatewayUrl: "https://gw.test" };
const json = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });

function client(instrumentsBody: unknown, log: string[] = []) {
  const f: ExnessFetch = async (url) => {
    log.push(url);
    if (url.includes("/v1/trading/access-point")) return json(200, { access_point: "https://ap.test" });
    if (url.includes("/configuration/accounts/123/instruments")) return json(200, instrumentsBody);
    return json(404, {});
  };
  return new ExnessApiClient({ env: ENV, fetchImpl: f });
}

async function main() {
  await test("classification: forex, metals, energy, indices, crypto, stocks", () => {
    const cases: [string, string][] = [["EURUSD", "forex"], ["GBPJPY", "forex"], ["USDZAR", "forex"], ["XAUUSD", "metals"], ["XAGUSD", "metals"], ["XCUUSD", "metals"], ["USOIL", "energy"], ["UKOIL", "energy"], ["XNGUSD", "energy"], ["US30", "indices"], ["USTEC", "indices"], ["DXY", "indices"], ["JP225", "indices"], ["BTCUSD", "crypto"], ["ETHUSD", "crypto"], ["XRPUSD", "crypto"], ["SOLUSD", "crypto"], ["AAPL", "stocks"], ["TSLA", "stocks"]];
    for (const [s, g] of cases) assert.equal(classifyExnessSymbol(s), g, s);
  });
  await test("labels: EUR/USD, XAU/USD, BTC/USD, US30 unchanged", () => {
    assert.equal(labelForSymbol("EURUSD", "forex"), "EUR/USD");
    assert.equal(labelForSymbol("XAUUSD", "metals"), "XAU/USD");
    assert.equal(labelForSymbol("BTCUSD", "crypto"), "BTC/USD");
    assert.equal(labelForSymbol("US30", "indices"), "US30");
  });
  await test("canonical entry maps the symbol to the mt5 provider with candles + quote", () => {
    const c = buildExnessCanonical(toExnessDto("GBPJPY", "Pound / Yen"));
    assert.equal(c.id, "GBPJPY");
    assert.equal(c.assetClass, "forex");
    assert.equal(c.providerMappings[0].provider, "mt5");
    assert.equal(c.providerMappings[0].providerSymbol, "GBPJPY");
    assert.deepEqual(c.providerMappings[0].supportedCapabilities, ["quote", "candles"]);
    assert.equal(c.discovery?.source, "exness-api");
  });
  await test("listInstruments: array of objects (name + description)", async () => {
    const list = await client([{ name: "EURUSD", description: "Euro vs US Dollar" }, { name: "XAUUSD" }]).listInstruments();
    assert.deepEqual(list.map((i) => i.symbol), ["EURUSD", "XAUUSD"]);
    assert.equal(list[0].description, "Euro vs US Dollar");
  });
  await test("listInstruments: { instruments: [...] } and { items: [...] } and array of strings", async () => {
    assert.equal((await client({ instruments: [{ symbol: "US30" }] }).listInstruments())[0].symbol, "US30");
    assert.equal((await client({ items: [{ instrument: "BTCUSD" }] }).listInstruments())[0].symbol, "BTCUSD");
    assert.deepEqual((await client(["AAPL", "TSLA"]).listInstruments()).map((i) => i.symbol), ["AAPL", "TSLA"]);
  });
  await test("listInstruments: junk rows are skipped, empty answer is an honest shape error", async () => {
    const list = await client([{ foo: 1 }, 42, null, { name: "bad symbol with spaces" }, { name: "EURUSD" }]).listInstruments();
    assert.deepEqual(list.map((i) => i.symbol), ["EURUSD"]);
    await assert.rejects(() => client([]).listInstruments(), (e) => e instanceof ExnessApiError && e.kind === "shape");
  });
  await test("listInstruments uses the configuration endpoint on the discovered access point (read-only GET)", async () => {
    const log: string[] = [];
    await client([{ name: "EURUSD" }], log).listInstruments();
    assert.ok(log.some((u) => u === "https://ap.test/v1/configuration/accounts/123/instruments"), log.join(" | "));
  });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
main();
