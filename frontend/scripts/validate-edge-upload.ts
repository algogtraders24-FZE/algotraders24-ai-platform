// scripts/validate-edge-upload.ts
// AT24 Trader Edge Analyzer (E3): the upload handler behind
// /api/private/edge-analyzer/analyze. House style (node:assert/strict, tsx).
// Run: npm run validate:edge-upload
// Optional REAL-file check (never committed; proves a production-size report
// fits the gzip wire limit): EDGE_REPORT_PATH="C:\path\Report.html"

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

import { MAX_DECODED_BYTES, MAX_WIRE_BYTES, processUpload } from "../services/edge-analyzer/upload";

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

const tr = (cells: string[]) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
const th = (cells: string[]) => `<tr>${cells.map((c) => `<th>${c}</th>`).join("")}</tr>`;
function miniReport(): string {
  const header = ["Time", "Position", "Symbol", "Type", "Volume", "Price", "S / L", "T / P", "Time", "Price", "Commission", "Swap", "Profit"];
  const rows = [0, 1, 2].map((i) => tr([`2026.09.14 1${i}:00:00`, String(i + 1), "US30", "buy", "Tag", "1", "100", "0", "0", `2026.09.14 1${i}:30:00`, "101", "0.00", "0.00", i === 1 ? "-5.00" : "10.00"]));
  return ["<html><body><table>", tr(["Trade History Report"]), tr(["Positions"]), th(header), ...rows, tr([""]), "</table></body></html>"].join("\n");
}
const utf16 = (s: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, "utf16le")]);

console.log("validation");
check("only .html/.htm accepted (case-insensitive); others are rejected before any parsing", () => {
  for (const name of ["report.pdf", "report.csv", "report", "report.html.exe", "", "../../etc/passwd"]) {
    const r = processUpload({ fileName: name, bytes: Buffer.from("x"), gzip: false });
    assert.ok(!r.ok && r.status === 400 && r.code === "UNSUPPORTED_FILE_TYPE", name);
  }
  assert.ok(processUpload({ fileName: "REPORT.HTML", bytes: utf16(miniReport()), gzip: false }).ok);
  assert.ok(processUpload({ fileName: "r.htm", bytes: utf16(miniReport()), gzip: false }).ok);
});
check("empty file -> 400 EMPTY_FILE (raw and gzip-of-nothing)", () => {
  const raw = processUpload({ fileName: "r.html", bytes: new Uint8Array(0), gzip: false });
  assert.ok(!raw.ok && raw.code === "EMPTY_FILE");
  const gz = processUpload({ fileName: "r.html", bytes: gzipSync(Buffer.alloc(0)), gzip: true });
  assert.ok(!gz.ok && gz.code === "EMPTY_FILE");
});
check("wire cap: oversize body -> FILE_TOO_LARGE", () => {
  const r = processUpload({ fileName: "r.html", bytes: new Uint8Array(MAX_WIRE_BYTES + 1), gzip: false });
  assert.ok(!r.ok && r.code === "FILE_TOO_LARGE");
});
check("gzip bomb: tiny upload that expands past the decoded cap is refused (no memory blow-up)", () => {
  const bomb = gzipSync(Buffer.alloc(MAX_DECODED_BYTES + 5_000_000, 0x41));
  assert.ok(bomb.length < MAX_WIRE_BYTES, "the bomb must fit the wire limit to be a real test");
  const r = processUpload({ fileName: "r.html", bytes: bomb, gzip: true });
  assert.ok(!r.ok && r.code === "FILE_TOO_LARGE");
});
check("invalid gzip -> 400 BAD_ENCODING; gzip flag on non-gzip data -> BAD_ENCODING", () => {
  const a = processUpload({ fileName: "r.html", bytes: Buffer.from("not gzip at all"), gzip: true });
  assert.ok(!a.ok && a.code === "BAD_ENCODING");
  const b = processUpload({ fileName: "r.html", bytes: gzipSync(Buffer.from("x")).subarray(0, 8), gzip: true });
  assert.ok(!b.ok && b.code === "BAD_ENCODING");
});
check("a non-MT5 html file -> 422 UNSUPPORTED_REPORT with a human message (no internals)", () => {
  const r = processUpload({ fileName: "page.html", bytes: Buffer.from("<html><table><tr><td>hi</td></tr></table></html>"), gzip: false });
  assert.ok(!r.ok && r.status === 422 && r.code === "UNSUPPORTED_REPORT");
  if (!r.ok) assert.match(r.message, /MetaTrader 5/);
});

console.log("happy path");
check("UTF-16 report, raw upload -> 200 with a report", () => {
  const r = processUpload({ fileName: "ReportHistory-1.html", bytes: utf16(miniReport()), gzip: false });
  assert.ok(r.ok && r.status === 200);
  if (r.ok) {
    assert.equal(r.report.core.tradeCount, 3);
    assert.equal(r.report.edge.level, "insufficient");
    assert.equal(r.report.ruin, null);
  }
});
check("same report gzip-compressed -> identical result to the raw upload", () => {
  const raw = utf16(miniReport());
  const a = processUpload({ fileName: "r.html", bytes: raw, gzip: false });
  const b = processUpload({ fileName: "r.html", bytes: gzipSync(raw), gzip: true });
  assert.ok(a.ok && b.ok);
  if (a.ok && b.ok) assert.deepEqual(a.report, b.report);
});
check("response contains no file name, no raw content, no PII-bearing fields", () => {
  const r = processUpload({ fileName: "ReportHistory-SECRET-123.html", bytes: utf16(miniReport()), gzip: false });
  assert.ok(r.ok);
  if (r.ok) assert.equal(JSON.stringify(r.report).includes("SECRET"), false);
});

const realPath = process.env.EDGE_REPORT_PATH;
if (realPath) {
  console.log("real production-size report");
  check("real report gzipped fits the wire limit and analyzes end-to-end", () => {
    const raw = readFileSync(realPath);
    const gz = gzipSync(raw);
    console.log(`      raw ${raw.length} bytes -> gzip ${gz.length} bytes (wire limit ${MAX_WIRE_BYTES})`);
    assert.ok(raw.length > MAX_WIRE_BYTES - 1_000_000, "this is a large report");
    assert.ok(gz.length < MAX_WIRE_BYTES);
    const t0 = Date.now();
    const r = processUpload({ fileName: realPath.split(/[\\/]/).pop()!, bytes: gz, gzip: true });
    assert.ok(r.ok);
    if (r.ok) {
      console.log(`      analyzed in ${Date.now() - t0} ms: trades=${r.report.core.tradeCount} reconciled=${r.report.reconciled} edge=${r.report.edge.level}`);
      assert.equal(r.report.reconciled, true);
    }
  });
}

console.log(`\nvalidate-edge-upload: ${passed} checks passed`);
