// scripts/validate-exec-bridge.ts - tests of the Execute bridge: token rules, order and report validation, the EA-facing handler (gates, atomic claim,
// reports), and the user-facing service (EA connected, queue limits, idempotency, cancel). No database: the in-memory store has the same semantics.
// Run: npx tsx scripts/validate-exec-bridge.ts
import { generateExecToken, hashExecToken, parseExecBearer } from "../services/exec-bridge/token";
import { parseExecOrderInput, parseExecReport, viewStatus } from "../services/exec-bridge/rules";
import { handleExecRequest } from "../services/exec-bridge/handler";
import { ExecOrderService } from "../services/exec-bridge/service";
import { MemoryExecStore } from "../services/exec-bridge/memory-store";
import { EXEC } from "../services/exec-bridge/config";
import { generateSyncToken } from "../services/live-sync/crypto";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => { if (ok) { pass++; console.log("  ok -", name); } else { fail++; console.log("  FAIL -", name); } };

const NOW = new Date("2026-11-23T12:00:00.000Z");
const at = (secs: number) => new Date(NOW.getTime() + secs * 1000);

const goodBody = { symbol: "BTCUSD", side: "buy", kind: "limit", volume: 0.01, price: 59556, stopLoss: 58943, takeProfit: 60782, clientNonce: "nonce-0001", confirm: true, plan: { score: 4 } };

async function main() {
  // ---------------- tokens
  const t = generateExecToken();
  check("an execute token has its own prefix and a stable hash", t.raw.startsWith("at24_exec_") && t.tokenHash === hashExecToken(t.raw) && t.prefix.length === 13);
  check("a valid bearer header is parsed", parseExecBearer(`Bearer ${t.raw}`) === t.raw);
  check("a Live Sync (ingest) token is NOT accepted as an execute token", parseExecBearer(`Bearer ${generateSyncToken().raw}`) === null);
  check("garbage, missing or oversized headers give null", parseExecBearer(null) === null && parseExecBearer("Basic abc") === null && parseExecBearer("Bearer " + "a".repeat(300)) === null && parseExecBearer("Bearer at24_exec_ bad token") === null);

  // ---------------- order input
  const ok = parseExecOrderInput(goodBody, 0.1, NOW);
  check("a valid confirmed limit order is accepted with the default 60 minute life", ok.ok && ok.value.expiresAt.getTime() === NOW.getTime() + 60 * 60_000 && ok.value.order.symbol === "BTCUSD");
  const mk = parseExecOrderInput({ ...goodBody, kind: "market", price: undefined, expiresInMinutes: 500 }, 0.1, NOW);
  check("a market order lives only 30 seconds, whatever the client asks", mk.ok && mk.value.expiresAt.getTime() === NOW.getTime() + EXEC.marketTtlSec * 1000);
  check("without confirm: true nothing is accepted", !parseExecOrderInput({ ...goodBody, confirm: undefined }, 0.1, NOW).ok && !parseExecOrderInput({ ...goodBody, confirm: "true" }, 0.1, NOW).ok);
  check("a missing or weak client nonce is refused", !parseExecOrderInput({ ...goodBody, clientNonce: "x" }, 0.1, NOW).ok && !parseExecOrderInput({ ...goodBody, clientNonce: "bad nonce!!" }, 0.1, NOW).ok);
  check("a stop loss is mandatory", !parseExecOrderInput({ ...goodBody, stopLoss: undefined }, 0.1, NOW).ok);
  check("lots above the cap, or with 3 decimals, are refused", !parseExecOrderInput({ ...goodBody, volume: 0.5 }, 0.1, NOW).ok && !parseExecOrderInput({ ...goodBody, volume: 0.015 }, 0.1, NOW).ok);
  check("stop and target on the wrong side are refused", !parseExecOrderInput({ ...goodBody, stopLoss: 60500 }, 0.1, NOW).ok && !parseExecOrderInput({ ...goodBody, takeProfit: 59000 }, 0.1, NOW).ok);
  check("a limit order may live at most 24 hours", !parseExecOrderInput({ ...goodBody, expiresInMinutes: 2000 }, 0.1, NOW).ok && parseExecOrderInput({ ...goodBody, expiresInMinutes: 1440 }, 0.1, NOW).ok);
  check("an injected symbol is refused", !parseExecOrderInput({ ...goodBody, symbol: "BTC USD;DROP" }, 0.1, NOW).ok);
  check("an oversized plan snapshot is dropped, not stored", (() => { const r = parseExecOrderInput({ ...goodBody, plan: { x: "y".repeat(3000) } }, 0.1, NOW); return r.ok && r.value.plan === null; })());

  // ---------------- status shown to the user
  const row = { status: "queued", expiresAt: at(-1), claimedAt: null as Date | null };
  check("a queued order past its expiry is shown as expired", viewStatus(row, NOW) === "expired" && viewStatus({ ...row, expiresAt: at(60) }, NOW) === "queued");
  check("a claimed order with no report for 2 minutes is shown as unknown, before that as sent", viewStatus({ status: "sent", expiresAt: at(60), claimedAt: at(-30) }, NOW) === "sent" && viewStatus({ status: "sent", expiresAt: at(60), claimedAt: at(-200) }, NOW) === "unknown");

  // ---------------- report input
  check("a filled report needs a ticket", !parseExecReport({ orderId: "ord12345678", outcome: "filled" }).ok && parseExecReport({ orderId: "ord12345678", outcome: "filled", ticket: "123456", price: 59556.5 }).ok);
  check("a refused report carries a cleaned, capped reason", (() => { const r = parseExecReport({ orderId: "ord12345678", outcome: "refused", reason: "bad\u0000 stops " + "z".repeat(400) }); return r.ok && !/\u0000/.test(r.value.reason ?? "") && (r.value.reason ?? "").length <= EXEC.maxReasonLen; })());
  check("an unknown outcome, a bad id or a bad ticket is refused", !parseExecReport({ orderId: "ord12345678", outcome: "won" }).ok && !parseExecReport({ orderId: "x", outcome: "refused" }).ok && !parseExecReport({ orderId: "ord12345678", outcome: "filled", ticket: "12ab" }).ok);

  // ---------------- EA-facing handler
  const store = new MemoryExecStore();
  const tokA = generateExecToken(), tokB = generateExecToken();
  const devA = store.addDevice("userA", tokA.tokenHash);
  store.addDevice("userB", tokB.tokenHash);
  const revoked = generateExecToken();
  store.addDevice("userA", revoked.tokenHash, { revoked: true });
  const inactive = generateExecToken();
  store.addDevice("userC", inactive.tokenHash, { userStatus: "suspended" });
  const req = (path: string, token: string | null, body: unknown, method = "POST") => new Request(`https://x.test${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: method === "GET" ? undefined : JSON.stringify(body) });
  const call = (route: "poll" | "report", token: string | null, body: unknown, method = "POST", enabled = true, burst?: { allow(k: string): boolean }) => handleExecRequest(req(`/api/exec/v1/${route}`, token, body, method), route, { enabled, store, now: () => NOW, burst });
  const j = async (r: Response) => (await r.json()) as Record<string, unknown>;

  check("disabled switch answers 503 before anything else", (await call("poll", tokA.raw, {}, "POST", false)).status === 503);
  check("a GET is refused with 405", (await call("poll", tokA.raw, {}, "GET")).status === 405);
  check("no token, a wrong token, a revoked token, a suspended user and a Live Sync token are all 401", (await call("poll", null, {})).status === 401 && (await call("poll", "at24_exec_nope", {})).status === 401 && (await call("poll", revoked.raw, {})).status === 401 && (await call("poll", inactive.raw, {})).status === 401 && (await call("poll", generateSyncToken().raw, {})).status === 401);
  check("an oversized body is refused with 413 and bad JSON with 400", (await handleExecRequest(new Request("https://x.test/p", { method: "POST", headers: { authorization: `Bearer ${tokA.raw}`, "content-length": "999999" }, body: "{}" }), "poll", { enabled: true, store })).status === 413 && (await handleExecRequest(new Request("https://x.test/p", { method: "POST", headers: { authorization: `Bearer ${tokA.raw}` }, body: "{not json" }), "poll", { enabled: true, store })).status === 400);
  check("the rate limiter answers 429", (await call("poll", tokA.raw, {}, "POST", true, { allow: () => false })).status === 429);
  check("an empty queue answers order: null and the poll marks the device as seen", (async () => true)() instanceof Promise && (await j(await call("poll", tokA.raw, {}))).order === null && store.devices.get(devA)?.lastSeenAt !== null);

  const svc = new ExecOrderService(store, () => NOW);
  const created = await svc.create("userA", goodBody);
  check("the user creates an order (the EA is connected)", created.ok && created.created && created.order.status === "queued");
  const p1 = await j(await call("poll", tokA.raw, {}));
  const p2 = await j(await call("poll", tokA.raw, {}));
  check("the EA gets the order once, with exactly the confirmed numbers, and a second poll gets nothing (never delivered twice)", (p1.order as { symbol: string; stopLoss: number; volume: number } | null)?.symbol === "BTCUSD" && (p1.order as { stopLoss: number }).stopLoss === 58943 && (p1.order as { volume: number }).volume === 0.01 && p2.order === null);
  check("another user's token never sees this order", (await j(await call("poll", tokB.raw, {}))).order === null);
  const orderId = (p1.order as { id: string }).id;
  check("another user cannot report on it (404), a malformed report is 400", (await call("report", tokB.raw, { orderId, outcome: "refused" })).status === 404 && (await call("report", tokA.raw, { orderId: "x", outcome: "refused" })).status === 400);
  const rep = await call("report", tokA.raw, { orderId, outcome: "filled", ticket: "7001", price: 59556.1, retcode: 10009 });
  check("the EA reports the fill and the user sees it", rep.status === 200 && (await svc.list("userA"))[0].status === "filled" && (await svc.list("userA"))[0].ticket === "7001");
  check("a second report for the same order is refused (409)", (await call("report", tokA.raw, { orderId, outcome: "refused", reason: "again" })).status === 409);

  // an order nobody picked up in time is never delivered later
  const mkt = await svc.create("userA", { ...goodBody, clientNonce: "nonce-0002", kind: "market", price: undefined, takeProfit: undefined, stopLoss: 58000 });
  check("a market order is queued", mkt.ok && mkt.created);
  const late = await handleExecRequest(req("/api/exec/v1/poll", tokA.raw, {}), "poll", { enabled: true, store, now: () => at(120) });
  check("two minutes later the stale market order is NOT delivered (expired)", (await j(late)).order === null && (await svc.list("userA")).find((o) => o.id === (mkt.ok ? mkt.order.id : ""))?.status === "expired");

  // ---------------- user-facing service
  const lone = new MemoryExecStore();
  const svc2 = new ExecOrderService(lone, () => NOW);
  const none = await svc2.create("userZ", { ...goodBody, clientNonce: "nonce-9999" });
  check("no connected EA, no order (NO_EA)", !none.ok && none.code === "NO_EA");
  const dz = lone.addDevice("userZ", generateExecToken().tokenHash, { lastSeenAt: at(-30) });
  void dz;
  const first = await svc2.create("userZ", { ...goodBody, clientNonce: "nonce-0100" });
  const again = await svc2.create("userZ", { ...goodBody, clientNonce: "nonce-0100" });
  check("pressing Confirm twice (same nonce) is one order", first.ok && again.ok && first.order.id === again.order.id && again.created === false && lone.orders.length === 1);
  for (let i = 1; i < EXEC.maxQueuedPerUser; i++) await svc2.create("userZ", { ...goodBody, clientNonce: `nonce-02${i}0` });
  const full = await svc2.create("userZ", { ...goodBody, clientNonce: "nonce-0999" });
  check("the queue is capped", !full.ok && full.code === "QUEUE_FULL");
  const cancelId = first.ok ? first.order.id : "";
  check("a queued order can be cancelled by its owner only, and a cancelled order is never delivered", (await svc2.cancel("userY", cancelId)) === false && (await svc2.cancel("userZ", cancelId)) === true && (await lone.claimNext("userZ", "d", NOW))?.id !== cancelId);
  check("an order claimed by the EA can no longer be cancelled", await (async () => { const c = await lone.claimNext("userZ", "d", NOW); return c !== null && (await svc2.cancel("userZ", c.id)) === false; })());
  const hourly = new MemoryExecStore();
  hourly.addDevice("userH", generateExecToken().tokenHash, { lastSeenAt: at(-5) });
  const svc3 = new ExecOrderService(hourly, () => NOW);
  for (let i = 0; i < EXEC.maxOrdersPerHour; i++) { const o = await svc3.create("userH", { ...goodBody, clientNonce: `hourly-${String(i).padStart(4, "0")}` }); if (o.ok) await hourly.cancelOrder("userH", o.order.id); }
  const over = await svc3.create("userH", { ...goodBody, clientNonce: "hourly-9999" });
  check("more than the hourly limit is refused (RATE_LIMITED)", !over.ok && over.code === "RATE_LIMITED");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
