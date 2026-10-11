// Validates the public-read limiter: window, per-key isolation, retry-after, key cap, client key parsing. Pure.
import assert from "node:assert/strict";
import { clientKey, createPublicReadLimiter } from "../lib/security/publicReadLimit";

let checks = 0;
const eq = <T>(a: T, b: T, m: string) => { assert.deepEqual(a, b, m); checks++; };

const lim = createPublicReadLimiter({ max: 3, windowMs: 10_000, maxKeys: 3 });
eq([lim.check("a", 0).allowed, lim.check("a", 1000).allowed, lim.check("a", 2000).allowed], [true, true, true], "first 3 allowed");
const blocked = lim.check("a", 3000);
eq([blocked.allowed, blocked.retryAfterSec], [false, 7], "4th blocked; retry when the oldest hit leaves the window (10s - 3s = 7s)");
eq(lim.check("b", 3000).allowed, true, "another key is independent");
eq(lim.check("a", 10_001).allowed, true, "after the oldest hit expires one more is allowed");
eq(lim.check("a", 10_002).allowed, false, "the window is full again (1000, 2000 and 10001 are inside it)");
eq(lim.check("a", 11_001).allowed, true, "the hit at 1000 expired: a slot is free");


// key cap: oldest keys are evicted, the limiter keeps working
const small = createPublicReadLimiter({ max: 1, windowMs: 60_000, maxKeys: 2 });
small.check("k1", 0); small.check("k2", 1); small.check("k3", 2);
eq(small.check("k3", 3).allowed, false, "a recent key is still tracked");
eq(small.check("k1", 4).allowed, true, "an evicted key starts fresh (memory stays bounded)");

const h = (m: Record<string, string>) => ({ get: (n: string) => m[n] ?? null });
eq(clientKey(h({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" })), "1.2.3.4", "first forwarded entry");
eq(clientKey(h({ "x-real-ip": " 5.6.7.8 " })), "5.6.7.8", "x-real-ip fallback");
eq(clientKey(h({})), "unknown", "unknown bucket");

console.log(`validate-public-read-limit: ${checks} checks passed`);
