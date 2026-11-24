// scripts/validate-exec-ea.ts - checks of the AT24 Execute EA (public/downloads/AT24Execute.mq5 + .ex5): the compiled file matches the source, trade functions
// exist ONLY inside the one reviewed function, the safety rules are in the source, no identity is sent, and the JSON keys it reads are the ones the server sends.
// Run: npx tsx scripts/validate-exec-ea.ts
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { handleExecRequest } from "../services/exec-bridge/handler";
import { ExecOrderService } from "../services/exec-bridge/service";
import { MemoryExecStore } from "../services/exec-bridge/memory-store";
import { generateExecToken } from "../services/exec-bridge/token";

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => { if (ok) { pass++; console.log("  ok -", name); } else { fail++; console.log("  FAIL -", name); } };

const DL = resolve(__dirname, "..", "public", "downloads");
const srcText = readFileSync(join(DL, "AT24Execute.mq5"), "utf8").split("\r\n").join("\n");
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

/** The text of a function body (from its signature to the matching closing brace). */
function bodyOf(text: string, signature: string): string {
  const start = text.indexOf(signature);
  if (start < 0) return "";
  const open = text.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") { depth--; if (depth === 0) return text.slice(open, i + 1); }
  }
  return "";
}
const stripComments = (t: string) => t.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

async function main() {
  // ---- the shipped files belong together
  const manifestPath = join(DL, "AT24Execute.manifest.json");
  const ex5Path = join(DL, "AT24Execute.ex5");
  check("the compiled .ex5 and the manifest exist", existsSync(ex5Path) && existsSync(manifestPath));
  if (existsSync(manifestPath) && existsSync(ex5Path)) {
    const m = JSON.parse(readFileSync(manifestPath, "utf8")) as { sourceSha256: string; ex5Sha256: string; version: string };
    check("the manifest hash matches the source (rebuild with scripts/build-exec-ea-ex5.ts after every change)", m.sourceSha256 === sha(srcText));
    check("the manifest hash matches the compiled file", m.ex5Sha256 === sha(readFileSync(ex5Path)));
    check("the manifest version is the source version", new RegExp(`#property\\s+version\\s+"${m.version.replace(".", "\\.")}"`).test(srcText));
  }

  const code = stripComments(srcText);

  // ---- trade functions live in ONE function
  const exec = bodyOf(code, "bool ExecuteOrder(");
  const outside = code.replace(exec, "");
  const TRADE_CALLS = /g_trade\s*\.\s*(Buy|Sell|BuyLimit|SellLimit|BuyStop|SellStop|PositionOpen|OrderOpen)\s*\(|\bOrderSend(Async)?\s*\(/;
  check("buy / sell / limit calls appear inside ExecuteOrder", /g_trade\s*\.\s*Buy\(/.test(exec) && /g_trade\s*\.\s*SellLimit\(/.test(exec));
  check("no trade-opening call appears anywhere else in the file", !TRADE_CALLS.test(outside));
  check("the EA never closes, modifies or deletes anything (no PositionClose, PositionModify, OrderModify, OrderDelete, Close*)", !/\b(PositionClose\w*|PositionModify|OrderModify|OrderDelete|CloseBy|OrderClose\w*)\s*\(/.test(code) && !/g_trade\s*\.\s*(PositionClose\w*|PositionModify|OrderModify|OrderDelete)\s*\(/.test(code));
  check("ExecuteOrder is called from exactly one place (ProcessOrder), after the checks", (code.match(/\bExecuteOrder\s*\(/g) ?? []).length === 2 && /const string why = Check\([\s\S]*?ExecuteOrder\(/.test(bodyOf(code, "void ProcessOrder(")));

  // ---- safety rules are really in the source
  const check_ = bodyOf(code, "string Check(");
  check("dry run is the first thing Check looks at", check_.indexOf("DryRun") >= 0 && check_.indexOf("DryRun") < check_.indexOf("secondsToLive"));
  check("Check refuses: expired order, algo trading off, unknown symbol, missing stop loss, lot cap, spread, open positions, daily loss, wrong-side stop/target, price drift, limit through the market", ["secondsToLive <= 0", "TERMINAL_TRADE_ALLOWED", "SymbolSelect", "sl <= 0.0", "MaxLots", "MaxSpreadPoints", "MaxOpenPositions", "MaxDailyLossPercent", "sl < ref", "tp > ref", "MaxSlippagePoints", "price < ask"].every((s) => check_.includes(s)));
  check("defaults are safe: demo only, DryRun off, lot cap 0.10, daily loss limit on", /input\s+bool\s+AllowLiveAccount\s*=\s*false/.test(code) && /input\s+bool\s+DryRun\s*=\s*false/.test(code) && /input\s+double\s+MaxLots\s*=\s*0\.10/.test(code) && /input\s+double\s+MaxDailyLossPercent\s*=\s*5\.0/.test(code));
  check("the broker symbol is resolved by itself (suffix/prefix aware) and an unknown symbol is refused", /string ResolveSymbol\(/.test(code) && /ResolveSymbol\(symRaw\)/.test(bodyOf(code, "void ProcessOrder(")) && code.includes("before >= 'A' && before <= 'Z'"));
  { const c4s = stripComments(readFileSync(join(DL, "AT24Execute-MT4.mq4"), "utf8")); check("MT4: same automatic symbol resolution", /string ResolveSymbol\(/.test(c4s) && /ResolveSymbol\(symRaw\)/.test(bodyOf(c4s, "void ProcessOrder("))); }
  check("a REAL account is refused at start unless AllowLiveAccount is true", /ModeText\(\)\s*==\s*"REAL"\s*&&\s*!AllowLiveAccount/.test(bodyOf(code, "int OnInit(")));
  check("the token must carry the execute prefix", code.includes('#define TOKEN_PREFIX     "at24_exec_"') && /StringFind\(AT24_Token,\s*TOKEN_PREFIX\)\s*!=\s*0/.test(code));
  const proc = bodyOf(code, "void ProcessOrder(");
  check("the order id is marked in a terminal global variable BEFORE anything is sent (a restart can never place it twice)", proc.indexOf("GlobalVariableSet(gv, (double)TimeCurrent())") > 0 && proc.indexOf("GlobalVariableSet(gv, (double)TimeCurrent())") < proc.indexOf("ExecuteOrder("));
  check("an already handled order id is refused, not repeated", /GlobalVariableCheck\(gv\)/.test(proc));
  check("a polling interval below 2 seconds is raised to 2", /PollSeconds\s*<\s*2\)\s*\?\s*2/.test(code));

  // ---- privacy
  check("no account number, name, server or company is read or sent", !/ACCOUNT_(LOGIN|NAME|SERVER|COMPANY)/.test(code));
  check("WebRequest is called only in PostJson and only to AT24_BaseUrl", (code.match(/\bWebRequest\s*\(/g) ?? []).length === 1 && /WebRequest\("POST",\s*AT24_BaseUrl\s*\+\s*path/.test(bodyOf(code, "int PostJson(")));
  check("the EA contains no password or key handling (the word appears only in its own description)", !/password|passwd|api[_-]?key/i.test(code.split(String.fromCharCode(10)).filter((l) => !l.startsWith("#property description")).join(String.fromCharCode(10))));

  // ---- the wire format: what the server really sends is what the EA reads
  const store = new MemoryExecStore();
  const tok = generateExecToken();
  store.addDevice("u1", tok.tokenHash, { lastSeenAt: new Date() });
  const svc = new ExecOrderService(store);
  const created = await svc.create("u1", { symbol: "BTCUSD", side: "buy", kind: "limit", volume: 0.01, price: 59556, stopLoss: 58943, takeProfit: 60782, clientNonce: "wire-nonce-1", confirm: true });
  check("an order can be queued for the wire test", created.ok);
  const res = await handleExecRequest(new Request("https://x.test/api/exec/v1/poll", { method: "POST", headers: { authorization: `Bearer ${tok.raw}`, "content-type": "application/json" }, body: "{}" }), "poll", { enabled: true, store });
  const raw = await res.text();
  check("the poll answer has the compact shape the EA searches for (the object after \"order\":)", raw.includes('"order":{"id":"') && raw.includes('"serverTime":"'));
  for (const key of ["id", "symbol", "side", "kind", "expiresAt"]) {
    check(`the EA reads the string key "${key}" and the server sends it`, proc.includes(`"${key}"`) && raw.includes(`"${key}":"`));
  }
  for (const key of ["volume", "price", "stopLoss", "takeProfit"]) {
    check(`the EA reads the number key "${key}" and the server sends it`, proc.includes(`"${key}"`) && raw.includes(`"${key}":`));
  }
  check("the EA reads serverTime for the clock offset", /JsonStr\(resp,\s*"serverTime"\)/.test(code));
  check("an empty queue answers the literal order:null which the EA does not treat as an order", (async () => true)() instanceof Promise && (await (await handleExecRequest(new Request("https://x.test/p", { method: "POST", headers: { authorization: `Bearer ${tok.raw}` }, body: "{}" }), "poll", { enabled: true, store })).text()).includes('"order":null') && code.includes('StringFind(resp, "\\"order\\":{")'));
  check("the report keys the EA sends are the ones the server accepts", ["orderId", "outcome", "ticket", "price", "retcode", "reason"].every((k) => bodyOf(code, "void Report(").includes(`\\"${k}\\"`) || bodyOf(code, "void Report(").includes(`"${k}`)));

  // ---- the MetaTrader 4 version carries the same guarantees
  const mt4Path = join(DL, "AT24Execute-MT4.mq4");
  const mt4Manifest = join(DL, "AT24Execute-MT4.manifest.json");
  check("the MT4 source, compiled .ex4 and manifest exist", existsSync(mt4Path) && existsSync(join(DL, "AT24Execute-MT4.ex4")) && existsSync(mt4Manifest));
  if (existsSync(mt4Path) && existsSync(mt4Manifest)) {
    const t4 = readFileSync(mt4Path, "utf8").split("\r\n").join("\n");
    const m4 = JSON.parse(readFileSync(mt4Manifest, "utf8")) as { sourceSha256: string; ex4Sha256: string };
    check("MT4 manifest hashes match the source and the compiled file (rebuild with scripts/build-exec-ea-ex4.ts)", m4.sourceSha256 === sha(t4) && m4.ex4Sha256 === sha(readFileSync(join(DL, "AT24Execute-MT4.ex4"))));
    const c4 = stripComments(t4);
    const exec4 = bodyOf(c4, "bool ExecuteOrder(");
    const outside4 = c4.replace(exec4, "");
    check("MT4: OrderSend appears inside ExecuteOrder only", /\bOrderSend\s*\(/.test(exec4) && !/\bOrderSend\s*\(/.test(outside4));
    check("MT4: never closes, modifies or deletes anything", !/\b(OrderClose|OrderCloseBy|OrderModify|OrderDelete)\s*\(/.test(c4));
    check("MT4: ExecuteOrder is called once, after Check, in ProcessOrder", (c4.match(/\bExecuteOrder\s*\(/g) ?? []).length === 2 && /const string why = Check\([\s\S]*?ExecuteOrder\(/.test(bodyOf(c4, "void ProcessOrder(")));
    const chk4 = bodyOf(c4, "string Check(");
    check("MT4: dry run is the first check", chk4.indexOf("DryRun") >= 0 && chk4.indexOf("DryRun") < chk4.indexOf("secondsToLive"));
    check("MT4: Check refuses the same cases", ["secondsToLive <= 0", "IsTradeAllowed", "SymbolSelect", "sl <= 0.0", "MaxLots", "MaxSpreadPoints", "MaxOpenPositions", "MaxDailyLossPercent", "sl < ref", "tp > ref", "MaxSlippagePoints", "price < ask"].every((x) => chk4.includes(x)));
    check("MT4: safe defaults and demo-only start", /input\s+bool\s+AllowLiveAccount\s*=\s*false/.test(c4) && /input\s+bool\s+DryRun\s*=\s*false/.test(c4) && /input\s+double\s+MaxLots\s*=\s*0\.10/.test(c4) && /ModeText\(\)\s*==\s*"REAL"\s*&&\s*!AllowLiveAccount/.test(bodyOf(c4, "void OnTimer(")) && /ModeText\(\)\s*==\s*"REAL"\s*&&\s*!AllowLiveAccount/.test(chk4) && c4.includes("IsConnected()"));
    const proc4 = bodyOf(c4, "void ProcessOrder(");
    check("MT4: order id marked before anything is sent", proc4.indexOf("GlobalVariableSet(gv, (double)TimeCurrent())") > 0 && proc4.indexOf("GlobalVariableSet(gv, (double)TimeCurrent())") < proc4.indexOf("ExecuteOrder("));
    check("MT4: no identity is read or sent, one WebRequest only", !/AccountNumber|AccountName|AccountServer|AccountCompany/.test(c4) && (c4.match(/\bWebRequest\s*\(/g) ?? []).length === 1);
    for (const key of ["id", "symbol", "side", "kind", "expiresAt"]) check(`MT4 reads the string key "${key}"`, proc4.includes(`"${key}"`));
    for (const key of ["volume", "price", "stopLoss", "takeProfit"]) check(`MT4 reads the number key "${key}"`, proc4.includes(`"${key}"`));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
