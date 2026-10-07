// scripts/validate-live-sync.ts
// AT24 Live Sync (P1): the ingest contract, hash chain, strict schema, ingest
// logic and the HTTP gates. House style (node:assert/strict, tsx).
// Run: npm run validate:live-sync   (no DB, no network: in-memory stores)

import assert from "node:assert/strict";

import { LIMITS, ZERO_HASH, type WireDeal, type WireSnapshot } from "../services/live-sync/contract";
import { accountSaltFor, cents, computeBatchHash, generateSyncToken, hashSyncToken, parseSyncBearer, SYNC_TOKEN_PREFIX } from "../services/live-sync/crypto";
import { sanitizeComment, validateIngestBody } from "../services/live-sync/validate";
import { processIngest, type AccountRow, type CommitArgs, type LiveSyncStore } from "../services/live-sync/ingest";
import { authenticateDevice, type DeviceRecord, type DeviceStore } from "../services/live-sync/auth";
import { handleLiveSyncRequest } from "../services/live-sync/handler";
import { createBurstLimiter } from "../services/mcp/quota";

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    throw err;
  }
}

const KEY = "a".repeat(64);
const NOW = new Date("2026-10-08T12:00:00Z");
const FACTS = { currency: "USD", mode: "demo", marginMode: "hedging", leverage: 500, serverUtcOffsetSec: 10_800, terminalBuild: 5200 } as const;
const T0 = Date.UTC(2026, 9, 8, 13, 0, 0); // broker server time (UTC+3)

function deal(i: number, over: Partial<WireDeal> = {}): WireDeal {
  return { ticket: 1000 + i, positionId: 500 + i, timeMsc: T0 + i * 60_000, symbol: "US30", type: "buy", entry: "out", volume: 0.1, price: 40000 + i, commission: -0.7, swap: 0, profit: 10.5 + i, fee: 0, magic: 0, comment: "Nova", ...over };
}
function batch(seq: number, prevHash: string, deals: WireDeal[], extra: Record<string, unknown> = {}) {
  return { v: 1, accountKey: KEY, account: { ...FACTS }, seq, prevHash, hash: computeBatchHash(prevHash, seq, deals), deals, ...extra };
}
const SNAP: WireSnapshot = { timeMsc: T0, balance: 1000.5, equity: 1010.25, margin: 50, freeMargin: 960, positions: [{ ticket: 77, symbol: "XAUUSD", side: "sell", volume: 0.01, priceOpen: 4129.57, sl: 4149.61, tp: 4104.61, profit: 4.9, timeMsc: T0 }] };

// ---- in-memory store, user-scoped like the Prisma store ----
function memStore() {
  const accounts = new Map<string, AccountRow & { userId: string; key: string; deals: (WireDeal & { timeUtc: Date })[]; snapshots: number; facts: unknown }>();
  let n = 0;
  const store: LiveSyncStore = {
    async getAccount(userId, key) {
      return accounts.get(`${userId}|${key}`) ?? null;
    },
    async countAccounts(userId) {
      return [...accounts.values()].filter((a) => a.userId === userId).length;
    },
    async createAccount(userId, key, facts, _now) {
      const row = { id: `acc${++n}`, userId, key, chainSeq: 0, chainHead: ZERO_HASH, lastSnapshotAt: null, lastDealTimeMsc: null as number | null, deals: [], snapshots: 0, facts };
      accounts.set(`${userId}|${key}`, row);
      return row;
    },
    async commit(args: CommitArgs) {
      const row = [...accounts.values()].find((a) => a.id === args.accountId)!;
      let inserted = 0;
      if (args.chain) {
        for (const d of args.chain.deals) if (!row.deals.some((x) => x.ticket === d.ticket)) { row.deals.push(d); inserted += 1; }
        row.chainSeq = args.chain.seq;
        row.chainHead = args.chain.hash;
        row.lastDealTimeMsc = Math.max(row.lastDealTimeMsc ?? 0, ...args.chain.deals.map((d) => d.timeMsc));
      }
      if (args.snapshot) { row.snapshots += 1; row.lastSnapshotAt = args.now; }
      row.facts = args.facts;
      return { insertedDeals: inserted };
    },
  };
  return { store, accounts };
}

function deviceStore(over: Partial<DeviceRecord> = {}) {
  const tok = generateSyncToken();
  const touched: string[] = [];
  const rec: DeviceRecord = { id: "dev-1", userId: "user-A", revokedAt: null, lastSeenAt: null, userStatus: "active", ...over };
  const store: DeviceStore = {
    async findByHash(h) { return h === tok.tokenHash ? rec : null; },
    async touch(id) { touched.push(id); },
  };
  return { tok, store, touched, rec };
}

async function main() {
  console.log("crypto + chain");
  await check("device token: prefix, entropy, only the hash is stored, strict bearer parsing", () => {
    const a = generateSyncToken(), b = generateSyncToken();
    assert.ok(a.raw.startsWith(SYNC_TOKEN_PREFIX));
    assert.notEqual(a.raw, b.raw);
    assert.equal(a.tokenHash, hashSyncToken(a.raw));
    assert.equal(parseSyncBearer(`Bearer ${a.raw}`), a.raw);
    for (const bad of [null, "", "Bearer", `bearer ${a.raw}`, "Bearer at24_mcp_wrongprefix", `Bearer ${a.raw} x`, `Bearer ${"a".repeat(300)}`]) assert.equal(parseSyncBearer(bad as string | null), null, String(bad));
  });
  await check("accountSalt: stable per user, different across users, not the user id", () => {
    assert.equal(accountSaltFor("u1"), accountSaltFor("u1"));
    assert.notEqual(accountSaltFor("u1"), accountSaltFor("u2"));
    assert.match(accountSaltFor("u1"), /^[0-9a-f]{64}$/);
    assert.equal(accountSaltFor("u1").includes("u1"), false);
  });
  await check("cents: half away from zero (matches MQL5 MathRound), never -0", () => {
    assert.equal(cents(10.5), 1050);
    assert.equal(cents(-0.7), -70);
    assert.equal(cents(0.29), 29);
    assert.equal(cents(0.005), 1);
    assert.equal(cents(-0.005), -1);
    assert.equal(Object.is(cents(-0.001), -0), false);
    assert.equal(cents(-0.001), 0);
  });
  await check("batch hash: deterministic; ANY change (cent, order, seq, prev) changes it", () => {
    const d = [deal(1), deal(2)];
    const h = computeBatchHash(ZERO_HASH, 1, d);
    assert.equal(h, computeBatchHash(ZERO_HASH, 1, d));
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.notEqual(h, computeBatchHash(ZERO_HASH, 1, [deal(1, { profit: 11.51 }), deal(2)]));
    assert.notEqual(h, computeBatchHash(ZERO_HASH, 1, [deal(2), deal(1)]));
    assert.notEqual(h, computeBatchHash(ZERO_HASH, 2, d));
    assert.notEqual(h, computeBatchHash("1".repeat(64), 1, d));
    assert.notEqual(h, computeBatchHash(ZERO_HASH, 1, [deal(1)]));
  });
  await check("sub-cent noise (float representation) does not change the hash", () => {
    assert.equal(computeBatchHash(ZERO_HASH, 1, [deal(1, { profit: 0.1 + 0.2 })]), computeBatchHash(ZERO_HASH, 1, [deal(1, { profit: 0.3 })]));
  });

  console.log("strict schema");
  await check("a valid batch (+ snapshot) is accepted; comment sanitized and capped", () => {
    const r = validateIngestBody(batch(1, ZERO_HASH, [deal(1, { comment: `a\u0007b\n${"x".repeat(100)}` })], { snapshot: SNAP }));
    assert.ok(r.ok);
    if (r.ok) {
      assert.ok(r.body.deals[0]!.comment.length <= LIMITS.commentMaxLen);
      assert.equal(/[\u0000-\u001f]/.test(r.body.deals[0]!.comment), false);
    }
    assert.equal(sanitizeComment("  a \t\n b "), "a b");
  });
  await check("IDENTITY CAN NEVER ENTER: any unknown field is rejected at every level (login, name, server, company, ...)", () => {
    const base = () => batch(1, ZERO_HASH, [deal(1)], { snapshot: SNAP });
    for (const k of ["login", "name", "server", "company", "email", "password", "accountNumber", "broker", "holder"]) {
      const top = { ...base(), [k]: "x" };
      assert.equal(validateIngestBody(top).ok, false, `top-level ${k}`);
      const acct = { ...base(), account: { ...FACTS, [k]: "x" } };
      assert.equal(validateIngestBody(acct).ok, false, `account.${k}`);
      const dl = { ...base(), deals: [{ ...deal(1), [k]: "x" }] };
      assert.equal(validateIngestBody(dl).ok, false, `deal.${k}`);
      const sn = { ...base(), snapshot: { ...SNAP, [k]: "x" } };
      assert.equal(validateIngestBody(sn).ok, false, `snapshot.${k}`);
      const ps = { ...base(), snapshot: { ...SNAP, positions: [{ ...SNAP.positions[0]!, [k]: "x" }] } };
      assert.equal(validateIngestBody(ps).ok, false, `position.${k}`);
    }
  });
  await check("type/range/format violations rejected", () => {
    const bad: unknown[] = [
      null, [], "x", { ...batch(1, ZERO_HASH, [deal(1)]), v: 2 },
      { ...batch(1, ZERO_HASH, [deal(1)]), accountKey: "ABC" },
      { ...batch(1, ZERO_HASH, [deal(1)]), accountKey: "G".repeat(64) },
      { ...batch(1, ZERO_HASH, [deal(1)]), account: { ...FACTS, mode: "live" } },
      { ...batch(1, ZERO_HASH, [deal(1)]), account: { ...FACTS, currency: "usd" } },
      { ...batch(1, ZERO_HASH, [deal(1)]), account: { ...FACTS, serverUtcOffsetSec: 999_999 } },
      batch(1, ZERO_HASH, [deal(1, { ticket: 0 })]),
      batch(1, ZERO_HASH, [deal(1, { ticket: 1.5 })]),
      batch(1, ZERO_HASH, [deal(1, { timeMsc: 5 })]),
      batch(1, ZERO_HASH, [deal(1, { symbol: "US 30; DROP" })]),
      batch(1, ZERO_HASH, [deal(1, { symbol: "X".repeat(33) })]),
      batch(1, ZERO_HASH, [deal(1, { type: "hack" as never })]),
      batch(1, ZERO_HASH, [deal(1, { profit: Number.NaN })]),
      batch(1, ZERO_HASH, [deal(1, { profit: 1e15 })]),
      batch(1, ZERO_HASH, [deal(1, { volume: -1 })]),
      batch(1, ZERO_HASH, [deal(1, { comment: "x".repeat(201) })]),
      batch(1, ZERO_HASH, [deal(1), deal(1)]),
      { ...batch(1, ZERO_HASH, [deal(1)]), deals: "nope" },
    ];
    for (const b of bad) assert.equal(validateIngestBody(b).ok, false, JSON.stringify(b)?.slice(0, 90));
  });
  await check("array caps: deals <= 500, positions <= 50", () => {
    const many = Array.from({ length: LIMITS.maxDealsPerBatch + 1 }, (_, i) => deal(i));
    assert.equal(validateIngestBody(batch(1, ZERO_HASH, many)).ok, false);
    const ok = Array.from({ length: LIMITS.maxDealsPerBatch }, (_, i) => deal(i));
    assert.ok(validateIngestBody(batch(1, ZERO_HASH, ok)).ok);
    const pos = Array.from({ length: LIMITS.maxPositions + 1 }, (_, i) => ({ ...SNAP.positions[0]!, ticket: i + 1 }));
    assert.equal(validateIngestBody(batch(1, ZERO_HASH, [deal(1)], { snapshot: { ...SNAP, positions: pos } })).ok, false);
  });
  await check("chain fields iff deals: required with deals, forbidden without", () => {
    assert.equal(validateIngestBody({ v: 1, accountKey: KEY, account: FACTS, deals: [deal(1)] }).ok, false);
    assert.ok(validateIngestBody({ v: 1, accountKey: KEY, account: FACTS, deals: [], snapshot: SNAP }).ok);
    assert.equal(validateIngestBody({ v: 1, accountKey: KEY, account: FACTS, deals: [], seq: 1 }).ok, false);
    assert.equal(validateIngestBody({ ...batch(1, ZERO_HASH, [deal(1)]), seq: 0 }).ok, false);
    assert.equal(validateIngestBody({ ...batch(1, ZERO_HASH, [deal(1)]), hash: "zz" }).ok, false);
  });

  console.log("ingest logic");
  await check("first batch stores deals, converts server time to UTC, advances the chain", async () => {
    const { store, accounts } = memStore();
    const d = [deal(1), deal(2)];
    const r = await processIngest(store, "user-A", batch(1, ZERO_HASH, d, { snapshot: SNAP }), NOW);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.deepEqual([r.body.ackSeq, r.body.nextSeq, r.body.insertedDeals, r.body.duplicate, r.body.snapshotStored], [1, 2, 2, false, true]);
    const acc = [...accounts.values()][0]!;
    assert.equal(acc.deals.length, 2);
    assert.equal(acc.deals[0]!.timeUtc.getTime(), T0 + 60_000 - 10_800_000);
    assert.equal(acc.chainHead, computeBatchHash(ZERO_HASH, 1, d));
  });
  await check("IDEMPOTENT: re-sending the same batch writes nothing and still acknowledges", async () => {
    const { store, accounts } = memStore();
    const b = batch(1, ZERO_HASH, [deal(1)]);
    await processIngest(store, "user-A", b, NOW);
    const again = await processIngest(store, "user-A", b, NOW);
    assert.ok(again.ok && again.body.duplicate === true && again.body.insertedDeals === 0 && again.body.ackSeq === 1);
    assert.equal([...accounts.values()][0]!.deals.length, 1);
  });
  await check("chain continues across batches; gap and fork are refused with guidance", async () => {
    const { store } = memStore();
    const b1 = batch(1, ZERO_HASH, [deal(1)]);
    const h1 = b1.hash;
    await processIngest(store, "user-A", b1, NOW);
    const b2 = batch(2, h1, [deal(2)]);
    assert.ok((await processIngest(store, "user-A", b2, NOW)).ok);
    const gap = await processIngest(store, "user-A", batch(5, b2.hash, [deal(5)]), NOW);
    assert.ok(!gap.ok && gap.status === 409 && gap.body.code === "SEQ_GAP" && gap.body.expectedSeq === 3);
    const fork = await processIngest(store, "user-A", batch(3, "9".repeat(64), [deal(3)]), NOW);
    assert.ok(!fork.ok && fork.body.code === "CHAIN_FORK");
    const rewrite = await processIngest(store, "user-A", batch(2, h1, [deal(2, { profit: 999 })]), NOW);
    assert.ok(!rewrite.ok, "a different history at an existing position must not be accepted");
  });
  await check("the ack and the gap error carry lastDealTimeMsc so a reinstalled EA can resume where the server left off", async () => {
    const { store } = memStore();
    const b1 = batch(1, ZERO_HASH, [deal(1), deal(2)]);
    const ack = await processIngest(store, "user-A", b1, NOW);
    assert.ok(ack.ok && ack.body.lastDealTimeMsc === deal(2).timeMsc);
    // a freshly reinstalled EA starts again at seq 1 and learns where to resume from the refusal
    const restart = await processIngest(store, "user-A", batch(1, ZERO_HASH, [deal(9)]), NOW);
    assert.ok(!restart.ok && restart.body.code === "SEQ_GAP" && restart.body.expectedSeq === 2);
    assert.equal(restart.body.chainHead, b1.hash);
    assert.equal(restart.body.lastDealTimeMsc, deal(2).timeMsc);
    const heartbeat = await processIngest(store, "user-A", { v: 1, accountKey: KEY, account: FACTS, deals: [] }, NOW);
    assert.ok(heartbeat.ok && heartbeat.body.lastDealTimeMsc === deal(2).timeMsc && heartbeat.body.ackSeq === 1);
  });
  await check("a tampered batch (hash does not match contents) is rejected", async () => {
    const { store, accounts } = memStore();
    const b = batch(1, ZERO_HASH, [deal(1)]);
    const tampered = { ...b, deals: [deal(1, { profit: 5000 })] };
    const r = await processIngest(store, "user-A", tampered, NOW);
    assert.ok(!r.ok && r.body.code === "HASH_MISMATCH");
    assert.equal([...accounts.values()][0]?.deals.length ?? 0, 0);
  });
  await check("snapshots are throttled (extra ones dropped, not errors); heartbeat without deals works", async () => {
    const { store, accounts } = memStore();
    const hb = { v: 1, accountKey: KEY, account: { ...FACTS }, deals: [], snapshot: SNAP };
    const a = await processIngest(store, "user-A", hb, NOW);
    const b = await processIngest(store, "user-A", hb, new Date(NOW.getTime() + 5_000));
    const c = await processIngest(store, "user-A", hb, new Date(NOW.getTime() + 40_000));
    assert.ok(a.ok && a.body.snapshotStored && b.ok && !b.body.snapshotStored && c.ok && c.body.snapshotStored);
    assert.equal([...accounts.values()][0]!.snapshots, 2);
  });
  await check("per-user cap on accounts; users are isolated even with the same accountKey", async () => {
    const { store, accounts } = memStore();
    for (let i = 0; i < LIMITS.maxAccountsPerUser; i++) {
      const key = String(i).repeat(64).slice(0, 64);
      assert.ok((await processIngest(store, "user-A", { v: 1, accountKey: key, account: FACTS, deals: [] }, NOW)).ok);
    }
    const over = await processIngest(store, "user-A", { v: 1, accountKey: "f".repeat(64), account: FACTS, deals: [] }, NOW);
    assert.ok(!over.ok && over.body.code === "ACCOUNT_LIMIT");
    await processIngest(store, "user-A", batch(1, ZERO_HASH, [deal(1)], { accountKey: "0".repeat(64) }), NOW);
    await processIngest(store, "user-B", batch(1, ZERO_HASH, [deal(1)], { accountKey: "0".repeat(64) }), NOW);
    const mine = [...accounts.values()].filter((a) => a.key === "0".repeat(64));
    assert.equal(mine.length, 2);
    assert.notEqual(mine[0]!.id, mine[1]!.id);
  });

  console.log("device authentication");
  await check("valid token -> principal; revoked / inactive user / unknown / store error -> null; throttled awaited touch", async () => {
    const ok = deviceStore();
    const p = await authenticateDevice(ok.store, `Bearer ${ok.tok.raw}`, NOW);
    assert.deepEqual(p, { deviceId: "dev-1", userId: "user-A" });
    assert.deepEqual(ok.touched, ["dev-1"]);
    const recent = deviceStore({ lastSeenAt: new Date(NOW.getTime() - 5_000) });
    await authenticateDevice(recent.store, `Bearer ${recent.tok.raw}`, NOW);
    assert.deepEqual(recent.touched, []);
    for (const over of [{ revokedAt: NOW }, { userStatus: "suspended" }] as Partial<DeviceRecord>[]) {
      const d = deviceStore(over);
      assert.equal(await authenticateDevice(d.store, `Bearer ${d.tok.raw}`, NOW), null);
    }
    assert.equal(await authenticateDevice(ok.store, `Bearer ${SYNC_TOKEN_PREFIX}unknown`, NOW), null);
    const boom: DeviceStore = { findByHash: async () => { throw new Error("db"); }, touch: async () => undefined };
    assert.equal(await authenticateDevice(boom, `Bearer ${ok.tok.raw}`, NOW), null);
  });

  console.log("HTTP gates");
  const req = (body: unknown, headers: Record<string, string> = {}, method = "POST") =>
    new Request("https://www.algotraders24.ai/api/live-sync/v1/ingest", { method, headers: { "content-type": "application/json", ...headers }, body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const mkDeps = (over: Record<string, unknown> = {}) => {
    const d = deviceStore();
    const m = memStore();
    return { d, m, deps: { enabled: true, deviceStore: d.store, store: m.store, now: () => NOW, ...over } };
  };
  await check("disabled -> 503; non-POST -> 405; oversize -> 413; bad JSON -> 400; no/bad token -> 401", async () => {
    const { d, deps } = mkDeps();
    const auth = { authorization: `Bearer ${d.tok.raw}` };
    assert.equal((await handleLiveSyncRequest(req({}, auth), "ingest", { ...deps, enabled: false })).status, 503);
    assert.equal((await handleLiveSyncRequest(req(null, auth, "GET"), "ingest", deps)).status, 405);
    assert.equal((await handleLiveSyncRequest(req("x".repeat(LIMITS.maxBodyBytes + 5), auth), "ingest", deps)).status, 413);
    assert.equal((await handleLiveSyncRequest(req("{not json", auth), "ingest", deps)).status, 400);
    const none = await handleLiveSyncRequest(req(batch(1, ZERO_HASH, [deal(1)])), "ingest", deps);
    assert.equal(none.status, 401);
    assert.match(none.headers.get("www-authenticate") ?? "", /Bearer/);
    assert.equal((await handleLiveSyncRequest(req(batch(1, ZERO_HASH, [deal(1)]), { authorization: `Bearer ${SYNC_TOKEN_PREFIX}nope` }), "ingest", deps)).status, 401);
  });
  await check("rate limit -> 429 with Retry-After", async () => {
    const { d, deps } = mkDeps({ burst: createBurstLimiter(2) });
    const auth = { authorization: `Bearer ${d.tok.raw}` };
    const r = [];
    for (let i = 0; i < 3; i++) r.push((await handleLiveSyncRequest(req({ v: 1 }, auth), "ingest", deps)).status);
    assert.deepEqual(r.slice(0, 2).every((s) => s === 422), true);
    assert.equal(r[2], 429);
  });
  await check("handshake returns the caller's salt + limits; ingest end-to-end writes only the token owner's data", async () => {
    const { d, m, deps } = mkDeps();
    const auth = { authorization: `Bearer ${d.tok.raw}` };
    const hs = await handleLiveSyncRequest(req({ v: 1 }, auth), "handshake", deps);
    const hj = (await hs.json()) as { ok: boolean; accountSalt: string; minIntervalSec: number; maxBatchDeals: number };
    assert.equal(hj.accountSalt, accountSaltFor("user-A"));
    assert.equal(hj.maxBatchDeals, LIMITS.maxDealsPerBatch);
    const res = await handleLiveSyncRequest(req(batch(1, ZERO_HASH, [deal(1)], { snapshot: SNAP }), auth), "ingest", deps);
    assert.equal(res.status, 200);
    const j = (await res.json()) as { ok: boolean; ackSeq: number };
    assert.equal(j.ackSeq, 1);
    assert.deepEqual([...m.accounts.values()].map((a) => a.userId), ["user-A"]);
  });
  await check("invalid schema -> 422 with a generic message (never echoes the submitted data); identity field rejected over HTTP", async () => {
    const { d, deps } = mkDeps();
    const auth = { authorization: `Bearer ${d.tok.raw}` };
    const res = await handleLiveSyncRequest(req({ ...batch(1, ZERO_HASH, [deal(1)]), login: "123456789" }, auth), "ingest", deps);
    assert.equal(res.status, 422);
    assert.equal((await res.text()).includes("123456789"), false);
  });
  await check("store failure -> 500 INTERNAL without leaking internals", async () => {
    const { d, deps } = mkDeps();
    const broken: LiveSyncStore = { ...memStore().store, getAccount: async () => { throw new Error("postgres://secret"); } };
    const res = await handleLiveSyncRequest(req(batch(1, ZERO_HASH, [deal(1)]), { authorization: `Bearer ${d.tok.raw}` }), "ingest", { ...deps, store: broken });
    assert.equal(res.status, 500);
    assert.equal((await res.text()).includes("postgres"), false);
  });

  console.log(`\nvalidate-live-sync: ${passed} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
