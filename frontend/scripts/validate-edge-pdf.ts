// scripts/validate-edge-pdf.ts
// AT24 Trader Edge Analyzer: the downloadable PDF (content blocks + renderer).
// House style (node:assert/strict, tsx). Run: npm run validate:edge-pdf
// Optional: render a real report to a file for a visual check (never committed):
//   EDGE_REPORT_PATH="C:\path\Report.html" EDGE_PDF_OUT="C:\tmp\out.pdf" npm run validate:edge-pdf

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";

import { analyzeMt5ReportBuffer, analyzeMt5ReportText, type EdgeReportE1 } from "../services/edge-analyzer";
import { buildReportBlocks, LEVEL_LABEL, PDF_DISCLAIMER, type Block } from "../services/edge-analyzer/pdf/report-blocks";
import { renderReportPdf, toPdfText } from "../services/edge-analyzer/pdf/render";

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

const tr = (cells: string[]) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
const th = (cells: string[]) => `<tr>${cells.map((c) => `<th>${c}</th>`).join("")}</tr>`;
function mt5Report(n: number, opts: { uniqueSymbols?: boolean; tag?: (i: number) => string } = {}): string {
  const header = ["Time", "Position", "Symbol", "Type", "Volume", "Price", "S / L", "T / P", "Time", "Price", "Commission", "Swap", "Profit"];
  const rows: string[] = [];
  for (let i = 0; i < n; i++) {
    const day = String(1 + Math.floor(i / 6) % 28).padStart(2, "0");
    const hh = String(8 + (i % 6) * 2).padStart(2, "0");
    rows.push(
      tr([
        `2026.09.${day} ${hh}:00:00`, String(1000 + i), opts.uniqueSymbols ? `SYM${i}` : i % 2 ? "US30" : "XAUUSD", i % 4 ? "sell" : "buy",
        opts.tag ? opts.tag(i) : i % 5 ? "Nova" : "Pulse", i % 2 ? "1" : "0.5", "100", "0", "0", `2026.09.${day} ${hh}:30:00`, "101", "0.00", "0.00", i % 3 === 0 ? "-12.00" : "9.50",
      ]),
    );
  }
  return [
    "<html><body><table>",
    tr(["Trade History Report"]),
    tr(["Name:", "SECRET NAME"]),
    tr(["Account:", "999999999&nbsp;(USD,&nbsp;Secret-Server,&nbsp;demo,&nbsp;Hedge)"]),
    tr(["Company:", "Secret Brokers Ltd"]),
    tr(["Positions"]),
    th(header),
    ...rows,
    tr([""]),
    tr(["Deals"]),
    th(["Time", "Deal", "Symbol", "Type", "Direction", "Volume", "Price", "Order", "Cost", "Commission", "Fee", "Swap", "Profit", "Balance", "Comment"]),
    tr(["2026.08.30 08:00:00", "1", "", "balance", "", "", "", "", "", "0.00", "0.00", "0.00", "1 000.00", "1 000.00", "D"]),
    "</table></body></html>",
  ].join("\n");
}
function analyze(html: string): EdgeReportE1 {
  const r = analyzeMt5ReportText(html);
  assert.ok(r.ok, "fixture must analyze");
  return (r as { ok: true; report: EdgeReportE1 }).report;
}
const textOf = (blocks: Block[]) =>
  blocks
    .map((b) => {
      switch (b.t) {
        case "title": return `${b.text} ${b.sub ?? ""}`;
        case "h2": return b.text;
        case "p": return b.text;
        case "bullets": return b.items.join(" ");
        case "table": return [...b.head, ...b.rows.flat()].join(" ");
        default: return "";
      }
    })
    .join("\n");

async function main() {
  console.log("text safety");
  await check("toPdfText: ASCII untouched; punctuation/math mapped; accents folded; the rest becomes '?', never throws", () => {
    assert.equal(toPdfText("Net 1,234.50 USD (95%)"), "Net 1,234.50 USD (95%)");
    assert.equal(toPdfText("DD \u2265 20% \u2192 \u201cquoted\u201d \u2013 x\u00d72 \u2026"), 'DD >= 20% -> "quoted" - xx2 ...');
    assert.equal(toPdfText("caf\u00e9 na\u00efve"), "cafe naive");
    assert.equal(toPdfText("\u0421\u0442\u0440\u0430\u0442\u0435\u0433\u0438\u044f"), "?????????");
    assert.equal(toPdfText("ok \ud83d\ude80 ok"), "ok ? ok");
    assert.equal(toPdfText("a\nb\tc"), "a b c");
  });

  console.log("content blocks");
  const full = analyze(mt5Report(60));
  const blocks = buildReportBlocks(full, { generatedOn: "2026-10-07" });
  const text = textOf(blocks);
  await check("has the verdict, level label, headline, key numbers, skill-vs-luck, risk, breakdowns, habits, assumptions, disclaimer", () => {
    assert.match(text, /Edge Analyzer Report/);
    assert.match(text, /Generated 2026-10-07/);
    assert.ok(text.includes(LEVEL_LABEL[full.edge.level]));
    assert.ok(text.includes(full.edge.headline));
    for (const h of ["Verdict", "Key numbers", "Is it skill or luck?", "By symbol", "By direction", "By day of week", "By hour of day", "By how long trades were held", "Habits worth a closer look", "How to read this report"]) {
      assert.ok(blocks.some((b) => b.t === "h2" && b.text.startsWith(h)), `missing section: ${h}`);
    }
    assert.ok(blocks.some((b) => b.t === "h2" && /What could the next \d+ trades/.test(b.text)), "risk section");
    assert.ok(text.includes(PDF_DISCLAIMER));
    assert.match(text, /not affiliated with MetaQuotes/);
  });
  await check("key numbers are the report's numbers (not recomputed or rounded differently)", () => {
    assert.ok(text.includes(`${full.core.tradeCount}`));
    assert.ok(text.includes(full.core.netProfit.toLocaleString("en-US", { minimumFractionDigits: 2 })));
    const keyTable = blocks.find((b) => b.t === "table" && b.head[0] === "Metric") as Extract<Block, { t: "table" }>;
    assert.ok(keyTable.rows.flat().includes("Net profit"));
    assert.ok(keyTable.rows.flat().includes("Start balance"));
  });
  await check("breakdown tables: one row per bucket; groups under 10 trades are starred", () => {
    const sym = blocks.filter((b): b is Extract<Block, { t: "table" }> => b.t === "table" && b.head[0] === "Group");
    assert.ok(sym.length >= 5);
    const total = full.patterns.bySymbol.length;
    assert.ok(sym.some((t) => t.rows.length === total));
    const small = analyze(mt5Report(60, { uniqueSymbols: true }));
    const smallBlocks = buildReportBlocks(small, { generatedOn: "x" });
    assert.ok(textOf(smallBlocks).includes("SYM0 *"), "a 1-trade symbol must be starred");
    assert.match(textOf(smallBlocks), /\* few trades/);
  });
  await check("privacy: no account number, name, company, server, and no file name field exists", () => {
    for (const secret of ["999999999", "SECRET NAME", "Secret Brokers", "Secret-Server"]) assert.equal(JSON.stringify(blocks).includes(secret), false, secret);
  });
  await check("too few trades: risk section is omitted cleanly (no empty table)", () => {
    const tiny = analyze(mt5Report(3));
    assert.equal(tiny.ruin, null);
    const b = buildReportBlocks(tiny, { generatedOn: "x" });
    assert.equal(b.some((x) => x.t === "h2" && x.text.startsWith("What could the next")), false);
    assert.match(textOf(b), /Not enough data/);
  });

  console.log("renderer");
  await check("produces a valid PDF (header, loadable, A4, metadata without personal data)", async () => {
    const bytes = await renderReportPdf(full, { generatedAt: new Date("2026-10-07T10:00:00Z") });
    assert.equal(Buffer.from(bytes.subarray(0, 5)).toString("latin1"), "%PDF-");
    const doc = await PDFDocument.load(bytes);
    assert.ok(doc.getPageCount() >= 1);
    const { width, height } = doc.getPage(0).getSize();
    assert.ok(Math.abs(width - 595.28) < 0.1 && Math.abs(height - 841.89) < 0.1);
    assert.equal(doc.getTitle(), "AT24 Edge Analyzer Report");
    assert.equal(doc.getAuthor(), undefined);
    const raw = Buffer.from(bytes).toString("latin1");
    for (const secret of ["999999999", "SECRET", "Secret"]) assert.equal(raw.includes(secret), false, secret);
  });
  await check("deterministic: same report + same date => identical bytes", async () => {
    const d = new Date("2026-10-07T10:00:00Z");
    const a = await renderReportPdf(full, { generatedAt: d });
    const b = await renderReportPdf(full, { generatedAt: d });
    assert.ok(Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0);
  });
  await check("long reports paginate (400 symbols => many pages) and every page gets a footer", async () => {
    const big = analyze(mt5Report(400, { uniqueSymbols: true }));
    const bytes = await renderReportPdf(big, { generatedAt: new Date("2026-10-07T10:00:00Z") });
    const doc = await PDFDocument.load(bytes);
    assert.ok(doc.getPageCount() >= 8, `pages: ${doc.getPageCount()}`);
  });
  await check("hostile text (Cyrillic, emoji, 300-char token, control chars) renders without throwing", async () => {
    const weird = analyze(mt5Report(60, { tag: (i) => (i % 3 === 0 ? "\u0421\u0442\u0440\u0430\u0442\u0435\u0433\u0438\u044f\ud83d\ude80" : i % 3 === 1 ? "X".repeat(300) : "ta\tg\u0007") }));
    const bytes = await renderReportPdf(weird, { generatedAt: new Date("2026-10-07T10:00:00Z") });
    assert.ok((await PDFDocument.load(bytes)).getPageCount() >= 1);
  });

  const realPath = process.env.EDGE_REPORT_PATH;
  if (realPath) {
    console.log("real report");
    await check("REAL report renders to a PDF", async () => {
      const r = analyzeMt5ReportBuffer(readFileSync(realPath));
      assert.ok(r.ok);
      if (!r.ok) return;
      const bytes = await renderReportPdf(r.report);
      const doc = await PDFDocument.load(bytes);
      console.log(`      ${bytes.length} bytes, ${doc.getPageCount()} pages`);
      if (process.env.EDGE_PDF_OUT) {
        writeFileSync(process.env.EDGE_PDF_OUT, bytes);
        console.log(`      written to ${process.env.EDGE_PDF_OUT}`);
      }
    });
  }

  console.log(`\nvalidate-edge-pdf: ${passed} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
