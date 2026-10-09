// scripts/validate-live-sync-ea-mt4.ts
// AT24 Live Sync for MetaTrader 4: static safety scan + wire compatibility + a real MT4 MetaEditor compile of
// public/downloads/AT24LiveSync-MT4.mq4. House style (node:assert/strict, tsx).
// Run: npx tsx scripts/validate-live-sync-ea-mt4.ts
//
// "Read-only, never trades, never sends identity" is a security claim, so it is CHECKED against the source on every run.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, copyFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { computeBatchHash, cents } from "../services/live-sync/crypto";
import { ZERO_HASH, LIMITS, type WireDeal } from "../services/live-sync/contract";
import { validateIngestBody } from "../services/live-sync/validate";
import { dealsToHistory } from "../services/live-sync/to-trades";

const EA_PATH = join(__dirname, "..", "public", "downloads", "AT24LiveSync-MT4.mq4");
const src = readFileSync(EA_PATH, "utf8");

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    throw err;
  }
}

/** Removes // and block comments but keeps string literals intact ("https://" contains //). */
function stripComments(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && (s[j] !== '"' || s[j - 1] === "\\")) j++;
      out += s.slice(i, j + 1);
      i = j;
    } else if (c === "/" && s[i + 1] === "/") {
      while (i < s.length && s[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && s[i + 1] === "*") {
      const end = s.indexOf("*/", i + 2);
      i = end < 0 ? s.length : end + 1;
    } else {
      out += c;
    }
  }
  return out;
}

const code = stripComments(src);

function functionBody(name: string): string {
  const re = new RegExp(`\\b${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = re.exec(code);
  assert.ok(m, `function ${name} not found`);
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) return code.slice(m.index, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

console.log("read-only guarantee");
check("no order-sending, modifying, closing or deleting identifier anywhere in the code (whole words)", () => {
  const forbidden = ["OrderSend", "OrderSendAsync", "OrderClose", "OrderCloseBy", "OrderModify", "OrderDelete", "OrderCheck", "OrderCalc", "ExpertRemove", "TerminalClose", "SendFTP", "SendMail", "SendNotification", "ShellExecute", "WinExec"];
  for (const word of forbidden) assert.equal(new RegExp(`\\b${word}\\b`).test(code), false, `forbidden identifier: ${word}`);
  assert.equal(/#include/.test(code), false, "the EA must not include any library");
  assert.equal(/#import/.test(code), false, "the EA must not import external DLLs");
});
check("only read APIs touch the account: order history, open orders, account info", () => {
  for (const must of ["OrdersHistoryTotal", "OrderSelect", "OrdersTotal", "AccountBalance", "AccountEquity", "WebRequest"]) assert.ok(code.includes(must), must);
  for (const read of ["OrderTicket", "OrderType", "OrderOpenTime", "OrderCloseTime", "OrderProfit", "OrderCommission", "OrderSwap", "OrderLots", "OrderMagicNumber", "OrderComment"]) assert.ok(code.includes(read), read);
});

console.log("no identity leaves the terminal");
check("name is never read; the broker company only inside the opt-in BrokerFactJson; login/server ONLY inside ComputeAccountKey", () => {
  assert.equal(code.includes("AccountName"), false, "AccountName");
  const brokerFn = functionBody("BrokerFactJson");
  assert.ok(brokerFn.includes("AccountCompany"), "AccountCompany is read by BrokerFactJson");
  assert.match(brokerFn, /if\(!ShareBrokerName\)\s*return "";/, "the broker name is gated by the opt-in input");
  assert.equal(code.replace(brokerFn, "").includes("AccountCompany"), false, "AccountCompany used outside BrokerFactJson");
  assert.match(code, /input bool\s+ShareBrokerName\s*=\s*false;/, "ShareBrokerName is off by default");
  const keyFn = functionBody("ComputeAccountKey");
  const withoutKeyFn = code.replace(keyFn, "");
  for (const word of ["AccountNumber", "AccountServer"]) {
    assert.ok(keyFn.includes(word), `${word} should be used by ComputeAccountKey`);
    assert.equal(withoutKeyFn.includes(word), false, `${word} used outside ComputeAccountKey`);
  }
  assert.match(keyFn, /Sha256Hex\(raw\)/, "the key must be hashed before use");
  assert.equal(/\bGlobalVariableSet\b|\bFileWriteString\([^)]*(NUMBER|SERVER)/i.test(code), false);
});
check("the only network calls go to the AT24 live-sync API over https", () => {
  const paths = [...code.matchAll(/PostJson\("([^"]+)"/g)].map((m) => m[1]);
  assert.ok(paths.length >= 3);
  for (const p of paths) assert.match(p!, /^\/api\/live-sync\/v1\/(handshake|ingest)$/);
  assert.equal([...code.matchAll(/WebRequest\(/g)].length, 1, "exactly one WebRequest call site");
  assert.match(code, /StringFind\(AT24_BaseUrl, "https:\/\/"\) != 0/);
});
check("demo-only by default, and refuses a live account unless the user opts in", () => {
  assert.match(code, /input bool\s+AllowLiveAccount\s*=\s*false;/);
  assert.match(code, /ModeText\(\) != "demo" && !AllowLiveAccount/);
});

console.log("wire compatibility with the server");
check("deal canonical form + chain hash input match services/live-sync/crypto.ts exactly", () => {
  const canon = functionBody("DealCanonical");
  assert.match(canon, /"%I64u:%I64d:%I64d:%I64d:%I64d:%I64d"/);
  assert.match(canon.replace(/\s+/g, " "), /d\.ticket, d\.timeMsc, CentsOf\(d\.profit\), CentsOf\(d\.commission\), CentsOf\(d\.swap\), CentsOf\(d\.fee\)/);
  assert.match(code.replace(/\s+/g, " "), /Sha256Hex\(g_head \+ "\|" \+ IntegerToString\(seq\) \+ "\|" \+ items\)/);
  assert.match(code, /items \+= ";";/);
  const d: WireDeal = { ticket: 2001, positionId: 1000, timeMsc: 1_791_000_000_000, symbol: "US30", type: "sell", entry: "out", volume: 0.1, price: 40000, commission: -0.7, swap: 0, profit: 10.5, fee: 0, magic: 0, comment: "x" };
  assert.equal(computeBatchHash(ZERO_HASH, 1, [d]).length, 64);
});
check("CentsOf and Money are the same as the MT5 EA (half away from zero, 2 decimals from cents)", () => {
  assert.match(functionBody("CentsOf").replace(/\s+/g, " "), /MathRound\(MathAbs\(x\) \* 100\.0\)/);
  assert.match(functionBody("CentsOf").replace(/\s+/g, " "), /\(x < 0\.0\) \? -r : r/);
  assert.match(functionBody("Money").replace(/\s+/g, " "), /DoubleToString\(\(double\)CentsOf\(x\) \/ 100\.0, 2\)/);
  assert.equal(cents(-0.005), -1);
});
check("the account block carries platform=mt4, hedging, and only fields the server's closed schema allows", () => {
  const facts = functionBody("AccountFactsJson").replace(/\s+/g, " ");
  assert.match(facts, /\\"platform\\":\\"mt4\\"/);
  assert.match(facts, /\\"marginMode\\":\\"hedging\\"/);
  for (const key of ["currency", "mode", "marginMode", "leverage", "serverUtcOffsetSec", "terminalBuild", "platform"]) assert.ok(facts.includes(`\\"${key}\\"`), key);
  const sample = { v: 1, accountKey: "a".repeat(64), account: { currency: "USD", mode: "demo", marginMode: "hedging", leverage: 500, serverUtcOffsetSec: 7200, terminalBuild: 1441, platform: "mt4" }, deals: [] };
  assert.equal(validateIngestBody(sample).ok, true, "the server accepts exactly this account block");
});
check("batch limits stay inside the server's caps: two deals per order, <=500 deals, <=50 positions", () => {
  const orders = Number(/#define MAX_ORDERS_PER_BATCH\s+(\d+)/.exec(src)?.[1]);
  const positions = Number(/#define MAX_POSITIONS\s+(\d+)/.exec(src)?.[1]);
  assert.ok(orders > 0 && orders * 2 <= LIMITS.maxDealsPerBatch, `${orders} orders = ${orders * 2} deals`);
  assert.ok(positions > 0 && positions <= LIMITS.maxPositions);
});
check("auth/failure behaviour: 401 stops retrying, 4060/4014 explain the allow-list, backoff is capped", () => {
  assert.match(code, /code == 401[\s\S]{0,200}g_fatal = true/);
  assert.match(code, /err == 4060/);
  assert.match(code, /wait < 300/);
});

console.log("order -> deal mapping (the rules the EA implements, run through the server's own mapper)");
check("deal tickets are derived from the order ticket (2n open, 2n+1 close) so a resend is always recognised", () => {
  const fn = functionBody("AppendOrderDeals").replace(/\s+/g, " ");
  assert.match(fn, /out\[n\]\.ticket = ticket \* 2;/);
  assert.match(fn, /out\[n \+ 1\]\.ticket = ticket \* 2 \+ 1;/);
  assert.match(fn, /out\[n\]\.position = ticket;/);
  assert.match(fn, /out\[n \+ 1\]\.position = ticket;/);
});
check("the opening deal is on the open time, the closing deal on the close time and carries commission, swap and profit", () => {
  const fn = functionBody("AppendOrderDeals").replace(/\s+/g, " ");
  assert.match(fn, /out\[n\]\.timeMsc = \(long\)OrderOpenTime\(\) \* 1000;/);
  assert.match(fn, /out\[n \+ 1\]\.timeMsc = \(long\)OrderCloseTime\(\) \* 1000;/);
  assert.match(fn, /out\[n \+ 1\]\.commission = OrderCommission\(\);/);
  assert.match(fn, /out\[n \+ 1\]\.swap = OrderSwap\(\);/);
  assert.match(fn, /out\[n \+ 1\]\.profit = OrderProfit\(\);/);
  assert.match(fn, /out\[n\]\.profit = 0;/);
  assert.match(fn, /out\[n \+ 1\]\.type = isBuy \? "sell" : "buy";/, "the closing deal is the opposite side");
});
check("deposits and withdrawals (order type 6) become balance deals; credits and cancelled pendings are skipped", () => {
  assert.match(code, /#define OP_BALANCE_TYPE\s+6/);
  const collect = functionBody("CollectDeals").replace(/\s+/g, " ");
  assert.match(collect, /t != OP_BUY && t != OP_SELL && t != OP_BALANCE_TYPE\) continue;/);
  assert.match(functionBody("AppendOrderDeals").replace(/\s+/g, " "), /out\[n\]\.type = "balance";/);
});
check("[sl]/[tp] markers MT4 appends to a closed order's comment are removed", () => {
  const fn = functionBody("CleanComment").replace(/\s+/g, " ");
  assert.match(fn, /tail == "\[sl\]" \|\| tail == "\[tp\]"/);
});
check("the cursor is (close second, ticket) so two orders closed in the same second are never skipped", () => {
  const collect = functionBody("CollectDeals").replace(/\s+/g, " ");
  assert.match(collect, /ct < g_fromSec \|\| \(ct == g_fromSec && tk <= g_fromTicket\)/);
});
check("server side: synthetic in/out deals of a closed MT4 order become exactly one closed trade; a balance order a balance op", () => {
  const T = (iso: string) => Date.parse(iso + "Z");
  const t = 123456; // MT4 order ticket
  const deals = [
    { positionId: "0", timeMsc: T("2026-10-01T08:00:00"), symbol: "", type: "balance", entry: "none", volume: 0, price: 0, commission: 0, swap: 0, profit: 5000, fee: 0, comment: "Deposit" },
    { positionId: String(t), timeMsc: T("2026-10-02T10:00:00"), symbol: "XAUUSD", type: "buy", entry: "in", volume: 0.5, price: 2650.1, commission: 0, swap: 0, profit: 0, fee: 0, comment: "Zenith_Buy" },
    { positionId: String(t), timeMsc: T("2026-10-02T14:30:00"), symbol: "XAUUSD", type: "sell", entry: "out", volume: 0.5, price: 2652.6, commission: -3.5, swap: -0.4, profit: 125, fee: 0, comment: "" },
    // a sell order that closed at a loss
    { positionId: "123457", timeMsc: T("2026-10-03T09:00:00"), symbol: "EURUSD", type: "sell", entry: "in", volume: 1, price: 1.1, commission: 0, swap: 0, profit: 0, fee: 0, comment: "" },
    { positionId: "123457", timeMsc: T("2026-10-03T09:20:00"), symbol: "EURUSD", type: "buy", entry: "out", volume: 1, price: 1.1005, commission: -7, swap: 0, profit: -50, fee: 0, comment: "" },
  ];
  const h = dealsToHistory(deals);
  assert.equal(h.trades.length, 2);
  assert.equal(h.balanceOps.length, 1);
  assert.equal(h.balanceOps[0]!.amount, 5000);
  const first = h.trades[0]!;
  assert.deepEqual([first.symbol, first.direction, first.volume, first.openTime, first.closeTime], ["XAUUSD", "buy", 0.5, T("2026-10-02T10:00:00"), T("2026-10-02T14:30:00")]);
  assert.equal(first.net, 125 - 3.5 - 0.4, "net = profit + commission + swap");
  assert.equal(first.tag, "Zenith_Buy");
  const second = h.trades[1]!;
  assert.deepEqual([second.direction, second.net], ["sell", -57], "a sell order is a short; the closing deal being a buy does not flip it");
  assert.equal(h.stillOpen + h.missingOpen, 0);
});

console.log("downloadable build (.ex4) matches the public source");
check("the .ex4 and the manifest are present and tied to THIS source (rebuild with scripts/build-live-sync-ex4.ts after any change)", () => {
  const dl = join(__dirname, "..", "public", "downloads");
  const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
  const shaText = (b: Buffer) => sha(Buffer.from(b.toString("utf8").split("\r\n").join("\n")));
  const manifest = JSON.parse(readFileSync(join(dl, "AT24LiveSync-MT4.manifest.json"), "utf8")) as { version: string; sourceSha256: string; ex4Sha256: string; ex4Bytes: number; ex4: string; source: string };
  assert.equal(manifest.source, "AT24LiveSync-MT4.mq4");
  assert.equal(manifest.ex4, "AT24LiveSync-MT4.ex4");
  assert.equal(manifest.sourceSha256, shaText(readFileSync(EA_PATH)), "the .mq4 changed since the .ex4 was built: run `npx tsx scripts/build-live-sync-ex4.ts`");
  const ex4 = readFileSync(join(dl, "AT24LiveSync-MT4.ex4"));
  assert.equal(manifest.ex4Sha256, sha(ex4), "the .ex4 does not match the manifest");
  assert.equal(manifest.ex4Bytes, ex4.length);
  assert.ok(ex4.length > 10_000, "compiled build looks truncated");
  assert.equal(manifest.version, /#property\s+version\s+"([^"]+)"/.exec(src)?.[1], "manifest version matches the source version");
});

console.log("real MT4 MetaEditor compile (Windows + MetaTrader 4 only)");
const editor = process.env.METAEDITOR4_PATH ?? "C:\\Program Files (x86)\\Vantage Markets MT4 Terminal\\metaeditor.exe";
if (process.platform === "win32" && existsSync(editor)) {
  check("compiles with 0 errors and 0 warnings", () => {
    const dir = mkdtempSync(join(tmpdir(), "at24ea4-"));
    const target = join(dir, "AT24LiveSync-MT4.mq4");
    copyFileSync(EA_PATH, target);
    const log = join(dir, "compile.log");
    writeFileSync(log, "");
    spawnSync(editor, [`/compile:${target}`, `/log:${log}`], { timeout: 90_000 });
    const raw = readFileSync(log);
    const text = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString("utf16le") : raw.toString("utf8");
    const m = /Result:\s*(\d+) errors?,\s*(\d+) warnings?/.exec(text);
    assert.ok(m, `no compile result in log:\n${text.slice(-400)}`);
    assert.equal(Number(m[1]), 0, `compile errors:\n${text}`);
    assert.equal(Number(m[2]), 0, `compile warnings:\n${text}`);
    assert.ok(existsSync(join(dir, "AT24LiveSync-MT4.ex4")));
  });
} else {
  console.log("  (skipped: MT4 MetaEditor not found; set METAEDITOR4_PATH to enable)");
}

console.log(`\nvalidate-live-sync-ea-mt4: ${passed} checks passed`);
