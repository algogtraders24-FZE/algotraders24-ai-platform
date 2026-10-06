// scripts/validate-edge-access.ts
// AT24 Trader Edge Analyzer: server-side plan gating. House style
// (node:assert/strict, tsx). Run: npm run validate:edge-access
//
// Proves a free response physically CONTAINS NONE of the paid data (it is not
// merely hidden by the UI), a full response is the untouched report, and every
// non-`true` entitlement value fails closed to free.

import assert from "node:assert/strict";

import { analyzeMt5ReportText } from "../services/edge-analyzer";
import { FREE_LOCKED_SECTIONS, toAccessResponse } from "../services/edge-analyzer/access";

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

// 60-trade synthetic MT5 report so every paid section (edge details, ruin, patterns) exists.
const tr = (cells: string[]) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
const th = (cells: string[]) => `<tr>${cells.map((c) => `<th>${c}</th>`).join("")}</tr>`;
function report60(): string {
  const header = ["Time", "Position", "Symbol", "Type", "Volume", "Price", "S / L", "T / P", "Time", "Price", "Commission", "Swap", "Profit"];
  const rows: string[] = [];
  for (let i = 0; i < 60; i++) {
    const day = String(1 + Math.floor(i / 6)).padStart(2, "0");
    const hh = String(8 + (i % 6) * 2).padStart(2, "0");
    const profit = i % 3 === 0 ? "-12.00" : "9.50";
    rows.push(tr([`2026.09.${day} ${hh}:00:00`, String(1000 + i), i % 2 ? "US30" : "XAUUSD", i % 4 ? "sell" : "buy", i % 5 ? "Nova" : "Pulse", i % 2 ? "1" : "0.5", "100", "0", "0", `2026.09.${day} ${hh}:30:00`, "101", "0.00", "0.00", profit]));
  }
  return [
    "<html><body><table>",
    tr(["Trade History Report"]),
    tr(["Account:", "999999&nbsp;(USD,&nbsp;X-Server,&nbsp;demo,&nbsp;Hedge)"]),
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

const analyzed = analyzeMt5ReportText(report60());
assert.ok(analyzed.ok, "fixture must analyze");
const rep = analyzed.ok ? analyzed.report : (null as never);

console.log("fixture sanity");
check("the fixture really produces every paid section (so the gating test is meaningful)", () => {
  assert.ok(rep.core.tradeCount === 60);
  assert.ok(rep.ruin !== null);
  assert.ok(rep.edge.perLot !== null);
  assert.ok(rep.patterns.byHour.length > 0 && rep.patterns.byHoldTime.length > 0 && rep.patterns.byDirection.length > 0);
});

console.log("gating");
check("full access -> the untouched report", () => {
  const r = toAccessResponse(rep, true);
  assert.equal(r.access, "full");
  assert.equal(r.report, rep);
});
check("free -> summary only: key numbers, headline, reconciliation, 3 breakdowns; plus the locked list", () => {
  const r = toAccessResponse(rep, false);
  assert.equal(r.access, "free");
  if (r.access !== "free") return;
  assert.equal(r.report.core.netProfit, rep.core.netProfit);
  assert.equal(r.report.edge.level, rep.edge.level);
  assert.equal(r.report.edge.headline, rep.edge.headline);
  assert.deepEqual(Object.keys(r.report.patterns).sort(), ["bySymbol", "byTag", "byWeekday"]);
  assert.deepEqual(r.report.reconciliation, rep.reconciliation);
  assert.deepEqual(r.locked, [...FREE_LOCKED_SECTIONS]);
});
check("free response contains NONE of the paid data anywhere in its JSON", () => {
  const json = JSON.stringify(toAccessResponse(rep, false));
  for (const key of ["ci95", "pValue", "tradesNeeded", "overlapPct", "lag1Autocorrelation", "dependenceFlag", "perLot", "tStat", "ruin", "scenarios", "probDrawdownReaches", "finalBalancePercentiles", "byHour", "byHoldTime", "byDirection", "sizeAfterOutcome", "avgVolumeAfterLoss", "seed", "resamples"]) {
    assert.equal(json.includes(`"${key}"`), false, `leaked: ${key}`);
  }
});
check("fail closed: anything other than boolean true is free", () => {
  for (const v of [false, undefined, null, 0, 1, "true", "yes", {}, []]) {
    assert.equal(toAccessResponse(rep, v as unknown as boolean).access, "free", String(v));
  }
});
check("the free response does not mutate the full report", () => {
  const before = JSON.stringify(rep);
  toAccessResponse(rep, false);
  assert.equal(JSON.stringify(rep), before);
});

console.log(`\nvalidate-edge-access: ${passed} checks passed`);
