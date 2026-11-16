// scripts/validate-exness-api.ts
// Standalone assert-based checks for the read-only Exness API client and its use inside Mt5Provider
// (Exness API first, VPS bridge as the fallback). No network: fetch is injected everywhere.
// Run via `npm run validate:exness-api`.
import assert from "node:assert/strict";
import { generateKeyPairSync, verify as edVerify } from "node:crypto";
import { ExnessApiClient, ExnessApiError, loadEd25519PrivateKey, signedHeaders, type ExnessFetch } from "../lib/market-data/exness-api";
import { loadExnessApiEnv } from "../lib/market-data/env";
import { Mt5Provider, type Mt5BridgeFetch } from "../lib/market-data/providers/mt5.provider";
import type { Clock } from "../lib/market-data/cache";

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

// a real Ed25519 key in Exness's 128-hex format (seed + public half)
const pair = generateKeyPairSync("ed25519");
const der = pair.privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;
const seed = der.subarray(der.length - 32);
const pubRaw = (pair.publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32);
const HEX = Buffer.concat([seed, pubRaw]).toString("hex");
const ENV = { apiKey: "test-key-id", privateKey: HEX, accountId: "21000208879", gatewayUrl: "https://gateway.example.test" };

function clockAt(ref: { t: number }): Clock {
  return { now: () => ref.t };
}
function json(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const AP = "https://ap-test.example.test";
function exnessFetch(log: string[], candles: unknown[] = [{ time: "2026-11-16T07:45:00+00:00", open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }]): ExnessFetch {
  return async (url) => {
    log.push(url);
    if (url.startsWith(ENV.gatewayUrl + "/v1/trading/access-point")) return json(200, { access_point: AP, account_id: ENV.accountId });
    if (url.includes("/market-data/accounts/")) {
      if (url.includes("price_type=both")) {
        return json(200, { candles: [{ time: "2026-11-16T07:59:00+00:00", bid: { open: 1, high: 1, low: 1, close: 3854.5 }, ask: { open: 1, high: 1, low: 1, close: 3854.54 }, volume: 3 }] });
      }
      return json(200, { candles });
    }
    return json(404, {});
  };
}

async function signingTests(): Promise<void> {
  await test("loadEd25519PrivateKey accepts 128-hex and 64-hex seeds, rejects junk", () => {
    loadEd25519PrivateKey(HEX);
    loadEd25519PrivateKey(Buffer.from(seed).toString("hex"));
    assert.throws(() => loadEd25519PrivateKey("not a key"), ExnessApiError);
    assert.throws(() => loadEd25519PrivateKey("<" + HEX + ">"), ExnessApiError);
  });

  await test("signedHeaders: signature verifies over the decoded EXN-DATA; empty-body hash is the documented value; no padding", () => {
    const key = loadEd25519PrivateKey(HEX);
    const h = signedHeaders(key, "k", "/v1/x?a=1", 1773656070123);
    const data = Buffer.from(h["EXN-DATA"].replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const sig = Buffer.from(h["EXN-SIGN"].replace(/-/g, "+").replace(/_/g, "/"), "base64");
    assert.equal(edVerify(null, data, pair.publicKey, sig), true);
    const p = JSON.parse(data.toString("utf-8"));
    assert.equal(p.method, "GET");
    assert.equal(p.path, "/v1/x?a=1");
    assert.equal(p.idempotency_key, "");
    assert.equal(p.body_hash, "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU");
    assert.ok(!h["EXN-DATA"].includes("=") && !h["EXN-SIGN"].includes("="));
    assert.equal(h["EXN-SIGN-VERSION"], "1");
  });
}

async function clientTests(): Promise<void> {
  await test("disabled by default: no env -> isEnabled false, getCandles throws 'disabled'", async () => {
    const c = new ExnessApiClient({ env: null });
    assert.equal(c.isEnabled(), false);
    await assert.rejects(c.getCandles("XAUUSD", "1h", 10), (e: unknown) => e instanceof ExnessApiError && e.kind === "disabled");
  });

  await test("loadExnessApiEnv: off unless EXNESS_API_ENABLED=1 and every value is valid", () => {
    const keep = { ...process.env };
    try {
      for (const k of Object.keys(process.env)) if (k.startsWith("EXNESS_API_")) delete process.env[k];
      assert.equal(loadExnessApiEnv(), null);
      Object.assign(process.env, { EXNESS_API_KEY: "k", EXNESS_API_PRIVATE_KEY: HEX, EXNESS_API_ACCOUNT_ID: "123", EXNESS_API_GATEWAY_URL: "https://g.example.test/" });
      assert.equal(loadExnessApiEnv(), null, "not enabled without EXNESS_API_ENABLED=1");
      process.env.EXNESS_API_ENABLED = "1";
      assert.equal(loadExnessApiEnv()?.gatewayUrl, "https://g.example.test");
      process.env.EXNESS_API_GATEWAY_URL = "http://plain.example.test";
      assert.equal(loadExnessApiEnv(), null, "plain http gateway is refused");
    } finally {
      for (const k of Object.keys(process.env)) if (k.startsWith("EXNESS_API_")) delete process.env[k];
      Object.assign(process.env, keep);
    }
  });

  await test("candles: access point discovered once and cached; negative count; bid price type; mapped to bridge shape", async () => {
    const log: string[] = [];
    const ref = { t: Date.UTC(2026, 10, 16, 8, 0, 0) };
    const c = new ExnessApiClient({ env: ENV, fetchImpl: exnessFetch(log), clock: clockAt(ref) });
    const a = await c.getCandles("XAUUSD", "15m", 50);
    await c.getCandles("XAUUSD", "1h", 50);
    assert.equal(log.filter((u) => u.includes("/access-point")).length, 1);
    const url = log.find((u) => u.includes("/market-data/"))!;
    assert.ok(url.startsWith(AP + "/v1/market-data/accounts/21000208879/candles?"));
    assert.ok(url.includes("instrument=XAUUSD") && url.includes("timeframe=M15") && url.includes("count=-50") && url.includes("price_type=bid"));
    assert.deepEqual(a[0], { datetime: "2026-11-16T07:45:00+00:00", open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 });
  });

  await test("quote: bid/ask from the latest M1 candle (price_type=both)", async () => {
    const c = new ExnessApiClient({ env: ENV, fetchImpl: exnessFetch([]), clock: clockAt({ t: Date.now() }) });
    const q = await c.getQuote("XAUUSD");
    assert.deepEqual(q, { bid: 3854.5, ask: 3854.54, providerTimestamp: "2026-11-16T07:59:00+00:00" });
  });

  await test("unsupported interval / oversized request are refused locally (caller falls back)", async () => {
    const c = new ExnessApiClient({ env: ENV, fetchImpl: exnessFetch([]) });
    await assert.rejects(c.getCandles("XAUUSD", "2h", 10), (e: unknown) => e instanceof ExnessApiError && e.kind === "unsupported");
    await assert.rejects(c.getCandles("XAUUSD", "1h", 5000), (e: unknown) => e instanceof ExnessApiError && e.kind === "unsupported");
  });

  await test("429 opens a 60 s circuit breaker (no hammering), then recovers", async () => {
    const ref = { t: 1_000_000 };
    let calls = 0;
    const f: ExnessFetch = async () => {
      calls += 1;
      return json(429, {});
    };
    const c = new ExnessApiClient({ env: ENV, fetchImpl: f, clock: clockAt(ref) });
    await assert.rejects(c.getCandles("XAUUSD", "1h", 5), (e: unknown) => e instanceof ExnessApiError && e.kind === "rate_limit");
    await assert.rejects(c.getCandles("XAUUSD", "1h", 5), (e: unknown) => e instanceof ExnessApiError && e.kind === "blocked");
    assert.equal(calls, 1);
    ref.t += 61_000;
    await assert.rejects(c.getCandles("XAUUSD", "1h", 5), (e: unknown) => e instanceof ExnessApiError && e.kind === "rate_limit");
    assert.equal(calls, 2);
  });

  await test("only GET requests are ever made", async () => {
    const methods: string[] = [];
    const f: ExnessFetch = async (url, init) => {
      methods.push(init.method);
      return exnessFetch([])(url, init);
    };
    const c = new ExnessApiClient({ env: ENV, fetchImpl: f });
    await c.getCandles("XAUUSD", "1h", 5);
    await c.getQuote("XAUUSD");
    assert.deepEqual([...new Set(methods)], ["GET"]);
  });
}

const BRIDGE_ENV = { bridgeUrl: "https://mt5.example.test", secret: "bridge-secret" };
function bridgeFetch(log: string[]): Mt5BridgeFetch {
  return async (url) => {
    log.push(url);
    if (url.includes("/candles")) return json(200, { candles: [{ datetime: "2026-11-16T07:00:00+00:00", open: 9, high: 9, low: 9, close: 9, volume: 1 }] });
    return json(200, { bid: 5, ask: 5.1, last: 0, volume: 1, time: "2026-11-16T08:00:00+00:00" });
  };
}

async function providerTests(): Promise<void> {
  await test("provider: Exness API is the primary source when it works (bridge not called)", async () => {
    const eLog: string[] = [];
    const bLog: string[] = [];
    const provider = new Mt5Provider({ env: BRIDGE_ENV, fetchImpl: bridgeFetch(bLog), exness: new ExnessApiClient({ env: ENV, fetchImpl: exnessFetch(eLog) }) });
    const candles = await provider.getTimeSeries({ symbol: "XAUUSD", interval: "15m", outputSize: 20 });
    assert.equal(candles[0].close, 1.5);
    assert.equal(provider.lastSource, "exness");
    assert.equal(bLog.length, 0);
    const snap = await provider.getSnapshot({ symbol: "XAUUSD" });
    assert.equal(snap.bid, 3854.5);
    assert.equal(bLog.length, 0);
  });

  await test("provider: any Exness failure falls back to the VPS bridge", async () => {
    const bLog: string[] = [];
    const failing: ExnessFetch = async () => json(403, {});
    const provider = new Mt5Provider({ env: BRIDGE_ENV, fetchImpl: bridgeFetch(bLog), exness: new ExnessApiClient({ env: ENV, fetchImpl: failing }) });
    const candles = await provider.getTimeSeries({ symbol: "XAUUSD", interval: "1h", outputSize: 20 });
    assert.equal(candles[0].close, 9);
    assert.equal(provider.lastSource, "bridge");
    const snap = await provider.getSnapshot({ symbol: "XAUUSD" });
    assert.equal(snap.bid, 5);
  });

  await test("provider: Exness disabled behaves exactly as before (bridge only)", async () => {
    const bLog: string[] = [];
    const provider = new Mt5Provider({ env: BRIDGE_ENV, fetchImpl: bridgeFetch(bLog), exness: new ExnessApiClient({ env: null }) });
    await provider.getTimeSeries({ symbol: "XAUUSD", interval: "1h", outputSize: 20 });
    assert.equal(provider.lastSource, "bridge");
    assert.equal(provider.isConfigured(), true);
  });

  await test("provider: nothing configured -> clean unconfigured error, no crash", async () => {
    const provider = new Mt5Provider({ env: null, exness: new ExnessApiClient({ env: null }) });
    assert.equal(provider.isConfigured(), false);
    await assert.rejects(provider.getSnapshot({ symbol: "XAUUSD" }), /not configured/);
  });
}

async function main(): Promise<void> {
  console.log("Exness API client + provider fallback");
  await signingTests();
  await clientTests();
  await providerTests();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
void main();
