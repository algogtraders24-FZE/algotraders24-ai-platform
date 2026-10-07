// scripts/validate-live-sync-ea.ts
// AT24 Live Sync: static safety scan + (on Windows with MetaTrader 5 installed)
// a real MetaEditor compile of public/downloads/AT24LiveSync.mq5.
// House style (node:assert/strict, tsx). Run: npm run validate:live-sync-ea
//
// The EA is a security claim ("read-only, never trades, never sends identity"), so
// the claim is CHECKED against the source on every run instead of being trusted.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, copyFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { computeBatchHash, cents } from "../services/live-sync/crypto";
import { ZERO_HASH, type WireDeal } from "../services/live-sync/contract";

const EA_PATH = join(__dirname, "..", "public", "downloads", "AT24LiveSync.mq5");
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

/** Source without comments, so a word in a comment cannot hide or fake a match. */
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
check("no trading, order, position-change or trade-library identifiers anywhere in the code", () => {
  const forbidden = [
    "OrderSend", "OrderSendAsync", "OrderOpen", "OrderModify", "OrderDelete", "OrderCheck", "OrderCalc",
    "PositionOpen", "PositionModify", "PositionClose", "PositionClosePartial",
    "CTrade", "CPositionInfo", "COrderInfo", "Trade.mqh", "MqlTradeRequest", "MqlTradeResult", "TRADE_ACTION_",
    "ORDER_TYPE_BUY", "ORDER_TYPE_SELL", "SymbolInfoTick", "ExpertRemove",
  ];
  for (const word of forbidden) assert.equal(code.includes(word), false, `forbidden identifier: ${word}`);
  assert.equal(/#include/.test(code), false, "the EA must not include any library");
  assert.equal(/#import/.test(code), false, "the EA must not import external DLLs");
});
check("only read APIs touch the account: history, positions, account info", () => {
  for (const must of ["HistorySelect", "HistoryDealGetTicket", "PositionGetTicket", "AccountInfoDouble", "WebRequest"]) assert.ok(code.includes(must), must);
});

console.log("no identity leaves the terminal");
check("name and company are never read; login/server are read ONLY inside ComputeAccountKey", () => {
  for (const word of ["ACCOUNT_NAME", "ACCOUNT_COMPANY"]) assert.equal(code.includes(word), false, word);
  const keyFn = functionBody("ComputeAccountKey");
  const withoutKeyFn = code.replace(keyFn, "");
  for (const word of ["ACCOUNT_LOGIN", "ACCOUNT_SERVER"]) {
    assert.ok(keyFn.includes(word), `${word} should be used by ComputeAccountKey`);
    assert.equal(withoutKeyFn.includes(word), false, `${word} used outside ComputeAccountKey`);
  }
  assert.match(keyFn, /Sha256Hex\(raw\)/, "the key must be hashed before use");
  assert.equal(/\bGlobalVariableSet\b|\bFileWriteString\([^)]*LOGIN/.test(code), false);
});
check("the only network calls go to the AT24 live-sync API over https", () => {
  const paths = [...code.matchAll(/PostJson\("([^"]+)"/g)].map((m) => m[1]);
  assert.ok(paths.length >= 3);
  for (const p of paths) assert.match(p!, /^\/api\/live-sync\/v1\/(handshake|ingest)$/);
  assert.equal(/WebRequest\(/.test(code), true);
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
  // the server side of the same contract, for a concrete example
  const d: WireDeal = { ticket: 1001, positionId: 7, timeMsc: 1_791_000_000_000, symbol: "US30", type: "buy", entry: "out", volume: 0.1, price: 40000, commission: -0.7, swap: 0, profit: 10.5, fee: 0, magic: 0, comment: "x" };
  assert.equal(computeBatchHash(ZERO_HASH, 1, [d]).length, 64);
});
check("CentsOf rounds half away from zero like the server's cents()", () => {
  assert.match(functionBody("CentsOf").replace(/\s+/g, " "), /MathRound\(MathAbs\(x\) \* 100\.0\)/);
  assert.match(functionBody("CentsOf").replace(/\s+/g, " "), /\(x < 0\.0\) \? -r : r/);
  assert.equal(cents(-0.005), -1);
});
check("money fields are sent with exactly 2 decimals derived from the cents value", () => {
  assert.match(functionBody("Money").replace(/\s+/g, " "), /DoubleToString\(\(double\)CentsOf\(x\) \/ 100\.0, 2\)/);
});
check("batch limits stay inside the server's caps (<=500 deals, <=50 positions)", () => {
  const deals = Number(/#define MAX_DEALS_PER_BATCH\s+(\d+)/.exec(src)?.[1]);
  const positions = Number(/#define MAX_POSITIONS\s+(\d+)/.exec(src)?.[1]);
  assert.ok(deals > 0 && deals <= 500);
  assert.ok(positions > 0 && positions <= 50);
});
check("auth/failure behaviour: 401 stops retrying, 4060 explains the allow-list, backoff is capped", () => {
  assert.match(code, /code == 401[\s\S]{0,200}g_fatal = true/);
  assert.match(code, /err == 4060/);
  assert.match(code, /wait < 300/);
});

console.log("real MetaEditor compile (Windows + MetaTrader 5 only)");
const editor = process.env.METAEDITOR_PATH ?? "C:\\Program Files\\MetaTrader 5\\MetaEditor64.exe";
if (process.platform === "win32" && existsSync(editor)) {
  check("compiles with 0 errors and 0 warnings", () => {
    const dir = mkdtempSync(join(tmpdir(), "at24ea-"));
    const target = join(dir, "AT24LiveSync.mq5");
    copyFileSync(EA_PATH, target);
    const log = join(dir, "compile.log");
    writeFileSync(log, "");
    spawnSync(editor, [`/compile:${target}`, `/log:${log}`], { timeout: 90_000 });
    const text = readFileSync(log).toString("utf16le");
    const m = /Result:\s*(\d+) errors?,\s*(\d+) warnings?/.exec(text);
    assert.ok(m, `no compile result in log:\n${text.slice(-400)}`);
    assert.equal(Number(m[1]), 0, `compile errors:\n${text}`);
    assert.equal(Number(m[2]), 0, `compile warnings:\n${text}`);
    assert.ok(existsSync(join(dir, "AT24LiveSync.ex5")));
  });
} else {
  console.log("  (skipped: MetaEditor not found; set METAEDITOR_PATH to enable)");
}

console.log(`\nvalidate-live-sync-ea: ${passed} checks passed`);
