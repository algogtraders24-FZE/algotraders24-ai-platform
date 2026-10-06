// services/edge-analyzer/pdf/render.ts
// AT24 Trader Edge Analyzer - draws the report blocks into an A4 PDF with
// pdf-lib (pure JS, runs in the browser: the report never leaves the user's
// device for this step). Standard Helvetica only, so all text is reduced to the
// characters that font can encode (see toPdfText) instead of ever throwing.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { buildReportBlocks, PDF_DISCLAIMER, type Block } from "./report-blocks";
import type { EdgeReportE1 } from "../index";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN_X = 48;
const TOP = PAGE_H - 54;
const BOTTOM = 62;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

const INK = rgb(0.1, 0.11, 0.14);
const MUTED = rgb(0.4, 0.42, 0.47);
const RULE = rgb(0.85, 0.86, 0.88);
const HEAD_FILL = rgb(0.94, 0.945, 0.95);
const GOLD = rgb(0.78, 0.62, 0.15);
const RED = rgb(0.72, 0.14, 0.14);
const GREEN = rgb(0.08, 0.5, 0.25);

const PUNCT: Record<string, string> = {
  "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...",
  "≥": ">=", "≤": "<=", "×": "x", "→": "->", "•": "-", " ": " ",
};

/** Reduce arbitrary text to printable ASCII so Helvetica can always encode it. */
export function toPdfText(input: string): string {
  let out = "";
  for (const ch of input.normalize("NFKD")) {
    if (PUNCT[ch] !== undefined) out += PUNCT[ch];
    else if (ch >= " " && ch <= "~") out += ch;
    else if (/\p{M}/u.test(ch)) continue; // combining accent left over from NFKD
    else if (ch === "\n" || ch === "\t") out += " ";
    else out += "?";
  }
  return out;
}

interface Cursor {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  regular: PDFFont;
  bold: PDFFont;
}

function newPage(cur: Cursor): void {
  cur.page = cur.doc.addPage([PAGE_W, PAGE_H]);
  cur.y = TOP;
}

function ensure(cur: Cursor, needed: number): void {
  if (cur.y - needed < BOTTOM) newPage(cur);
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = toPdfText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    // A single token wider than the line (very long tag): hard-split it.
    let rest = w;
    while (font.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut -= 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

function drawLines(cur: Cursor, lines: string[], opts: { font: PDFFont; size: number; color: ReturnType<typeof rgb>; x: number; lead: number }): void {
  for (const ln of lines) {
    ensure(cur, opts.lead);
    cur.page.drawText(ln, { x: opts.x, y: cur.y - opts.size, size: opts.size, font: opts.font, color: opts.color });
    cur.y -= opts.lead;
  }
}

function drawTable(cur: Cursor, block: Extract<Block, { t: "table" }>): void {
  const size = 8.5;
  const lead = 14;
  const total = block.widths.reduce((a, b) => a + b, 0);
  const colW = block.widths.map((w) => (w / total) * CONTENT_W);
  const xs: number[] = [];
  let x = MARGIN_X;
  for (const w of colW) {
    xs.push(x);
    x += w;
  }
  const cellX = (i: number, text: string, font: PDFFont) => (block.align[i] === "r" ? xs[i]! + colW[i]! - 4 - font.widthOfTextAtSize(text, size) : xs[i]! + 4);
  const fit = (text: string, i: number, font: PDFFont): string => {
    let t = toPdfText(text);
    const max = colW[i]! - 8;
    if (font.widthOfTextAtSize(t, size) <= max) return t;
    while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > max) t = t.slice(0, -1);
    return `${t}...`;
  };

  const header = () => {
    ensure(cur, lead * 2);
    cur.page.drawRectangle({ x: MARGIN_X, y: cur.y - lead, width: CONTENT_W, height: lead, color: HEAD_FILL });
    block.head.forEach((h, i) => {
      const t = fit(h, i, cur.bold);
      cur.page.drawText(t, { x: cellX(i, t, cur.bold), y: cur.y - lead + 4, size, font: cur.bold, color: INK });
    });
    cur.y -= lead;
  };

  header();
  for (const row of block.rows) {
    if (cur.y - lead < BOTTOM) {
      newPage(cur);
      header();
    }
    row.forEach((cell, i) => {
      const t = fit(cell, i, cur.regular);
      let color = INK;
      if (block.signColumns?.includes(i)) color = t.startsWith("-") ? RED : t === "-" ? INK : GREEN;
      cur.page.drawText(t, { x: cellX(i, t, cur.regular), y: cur.y - lead + 4, size, font: cur.regular, color });
    });
    cur.page.drawLine({ start: { x: MARGIN_X, y: cur.y - lead }, end: { x: MARGIN_X + CONTENT_W, y: cur.y - lead }, thickness: 0.4, color: RULE });
    cur.y -= lead;
  }
  cur.y -= 6;
}

function drawBlock(cur: Cursor, block: Block): void {
  switch (block.t) {
    case "title": {
      ensure(cur, 60);
      cur.page.drawText(toPdfText(block.text), { x: MARGIN_X, y: cur.y - 20, size: 20, font: cur.bold, color: INK });
      cur.y -= 28;
      cur.page.drawRectangle({ x: MARGIN_X, y: cur.y - 2, width: 46, height: 2.5, color: GOLD });
      cur.y -= 12;
      if (block.sub) drawLines(cur, wrap(block.sub, cur.regular, 9, CONTENT_W), { font: cur.regular, size: 9, color: MUTED, x: MARGIN_X, lead: 13 });
      cur.y -= 4;
      return;
    }
    case "h2": {
      ensure(cur, 56); // keep a heading together with the content that follows it
      cur.y -= 8;
      cur.page.drawText(toPdfText(block.text), { x: MARGIN_X, y: cur.y - 13, size: 13, font: cur.bold, color: INK });
      cur.y -= 20;
      return;
    }
    case "p": {
      const size = block.muted ? 8.5 : 10;
      drawLines(cur, wrap(block.text, cur.regular, size, CONTENT_W), { font: cur.regular, size, color: block.muted ? MUTED : INK, x: MARGIN_X, lead: size + 4 });
      cur.y -= 3;
      return;
    }
    case "bullets": {
      const size = block.muted ? 8.5 : 10;
      for (const item of block.items) {
        const lines = wrap(item, cur.regular, size, CONTENT_W - 12);
        ensure(cur, size + 4);
        cur.page.drawText("-", { x: MARGIN_X + 2, y: cur.y - size, size, font: cur.regular, color: block.muted ? MUTED : INK });
        drawLines(cur, lines, { font: cur.regular, size, color: block.muted ? MUTED : INK, x: MARGIN_X + 12, lead: size + 4 });
        cur.y -= 1;
      }
      cur.y -= 3;
      return;
    }
    case "table":
      drawTable(cur, block);
      return;
    case "spacer":
      cur.y -= block.h;
      return;
  }
}

/** Renders the full report to PDF bytes. */
export async function renderReportPdf(report: EdgeReportE1, opts: { generatedAt?: Date } = {}): Promise<Uint8Array> {
  const generatedAt = opts.generatedAt ?? new Date();
  const doc = await PDFDocument.create();
  doc.setTitle("AT24 Edge Analyzer Report");
  doc.setCreator("AT24");
  doc.setProducer("AT24 Edge Analyzer");
  doc.setCreationDate(generatedAt);
  doc.setModificationDate(generatedAt); // fixed dates => the same report renders to identical bytes
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const cur: Cursor = { doc, page: doc.addPage([PAGE_W, PAGE_H]), y: TOP, regular, bold };

  const generatedOn = generatedAt.toISOString().slice(0, 10);
  const blocks = buildReportBlocks(report, { generatedOn });
  blocks.forEach((block, i) => {
    // Keep a heading with its table: small tables stay whole, long ones keep at
    // least a header and a few rows together with the heading (no orphan rows).
    const next = blocks[i + 1];
    if (block.t === "h2" && next?.t === "table") {
      const rowsToKeep = next.rows.length <= 10 ? next.rows.length : 4;
      ensure(cur, 8 + 20 + 14 * (1 + rowsToKeep));
    }
    drawBlock(cur, block);
  });

  // Footer + page numbers once the page count is known.
  const pages = doc.getPages();
  pages.forEach((page, i) => {
    page.drawLine({ start: { x: MARGIN_X, y: 46 }, end: { x: PAGE_W - MARGIN_X, y: 46 }, thickness: 0.5, color: RULE });
    page.drawText(toPdfText(`AT24 Edge Analyzer  |  ${PDF_DISCLAIMER}`), { x: MARGIN_X, y: 34, size: 7, font: regular, color: MUTED });
    const num = `Page ${i + 1} of ${pages.length}`;
    page.drawText(num, { x: PAGE_W - MARGIN_X - regular.widthOfTextAtSize(num, 7.5), y: 34, size: 7.5, font: regular, color: MUTED });
  });
  return doc.save();
}
