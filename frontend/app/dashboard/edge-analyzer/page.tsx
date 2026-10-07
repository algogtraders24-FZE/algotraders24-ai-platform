"use client";
// app/dashboard/edge-analyzer/page.tsx
// AT24 Trader Edge Analyzer. Upload a MetaTrader 5 Trade History Report (HTML)
// and read where the results come from, whether the edge is distinguishable from
// luck, and the spread of risk. ANALYZE-ONLY: nothing is saved. The browser gzips
// the file (Vercel body limit vs UTF-16 reports) before sending.
//
// Every number is computed server-side and deterministically; this page only
// renders it. Plan gating is enforced on the server: a free account receives the
// summary only, and the locked sections are simply absent from the response.
// Wording is descriptive, never advice or a promise.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import ButtonLink from "@/components/ui/ButtonLink";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";
import type { BadgeTone } from "@/components/ui/Badge";
import StatCard from "@/components/ui/StatCard";
import type { EdgeAnalyzeResponse } from "@/services/edge-analyzer/access";
import type { BucketStat } from "@/services/edge-analyzer/analysis/patterns";
import type { EdgeLevel } from "@/services/edge-analyzer/analysis/edge-evidence";

interface SavedRow {
  id: string;
  createdAt: string;
  tradeCount: number;
  level: string;
}

const LEVEL_TONE: Record<EdgeLevel, BadgeTone> = {
  insufficient: "neutral",
  negative: "danger",
  none: "neutral",
  weak: "warning",
  moderate: "info",
  strong: "success",
};
const LEVEL_LABEL: Record<EdgeLevel, string> = {
  insufficient: "Not enough data",
  negative: "Negative evidence",
  none: "No evidence of edge",
  weak: "Weak evidence",
  moderate: "Moderate evidence",
  strong: "Strong evidence",
};

function money(n: number | null | undefined, cur: string | null): string {
  if (n === null || n === undefined) return "-";
  const s = `${n < 0 ? "-" : ""}${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return cur ? `${s} ${cur}` : s;
}
const pct = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? "-" : `${n.toFixed(d)}%`);
const prob = (n: number) => `${(n * 100).toFixed(n > 0 && n < 0.1 ? 1 : 0)}%`;
function minutes(ms: number | null): string {
  if (ms === null) return "-";
  const m = ms / 60000;
  return m >= 120 ? `${(m / 60).toFixed(1)} h` : `${m.toFixed(0)} min`;
}
/** Bucket keys carry a sort prefix ("3 Wed", "2 1-5 min"); show only the label. */
const label = (k: string) => k.replace(/^\d\s/, "");

async function gzipFile(file: File): Promise<{ body: Blob; gzip: boolean }> {
  if (typeof CompressionStream === "undefined") return { body: file, gzip: false };
  const stream = file.stream().pipeThrough(new CompressionStream("gzip"));
  return { body: await new Response(stream).blob(), gzip: true };
}

function BarList({ title, rows, cur, sort }: { title: string; rows: BucketStat[]; cur: string | null; sort?: "net" }) {
  const list = sort === "net" ? [...rows].sort((a, b) => b.net - a.net) : rows;
  const max = Math.max(1, ...list.map((r) => Math.abs(r.net)));
  return (
    <Card className="space-y-3">
      <p className="text-sm font-semibold text-text">{title}</p>
      <ul className="space-y-2">
        {list.map((r) => (
          <li key={r.key} className="text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-text">
                {label(r.key)} <span className="text-xs text-text-3">· {r.count} trades · {pct(r.winRatePct, 0)} win{r.lowSample ? " · few trades" : ""}</span>
              </span>
              <span className={r.net < 0 ? "fin-num text-danger" : "fin-num text-success"}>{money(r.net, cur)}</span>
            </div>
            <div className="mt-1 h-1.5 w-full rounded bg-ink-3">
              <div className={r.net < 0 ? "h-1.5 rounded bg-danger/70" : "h-1.5 rounded bg-success/70"} style={{ width: `${Math.max(2, (Math.abs(r.net) / max) * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function EdgeAnalyzerPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [res, setRes] = useState<EdgeAnalyzeResponse | null>(null);
  const [saveIt, setSaveIt] = useState(false);
  const [savedList, setSavedList] = useState<SavedRow[]>([]);

  const loadSaved = useCallback(async () => {
    try {
      const r = await fetch("/api/private/edge-analyzer/saved", { cache: "no-store" });
      const json = await r.json();
      if (r.ok) setSavedList(json.data.analyses as SavedRow[]);
    } catch {
      // Saved analyses are optional; the analyzer works without them.
    }
  }, []);

  useEffect(() => {
    void loadSaved();
  }, [loadSaved]);

  async function deleteSaved(id: string) {
    try {
      await fetch(`/api/private/edge-analyzer/saved?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    } finally {
      await loadSaved();
    }
  }
  const [fileName, setFileName] = useState<string | null>(null);

  // Deep link from Live Sync: /dashboard/edge-analyzer?syncedAccount=<id> analyzes a synced account.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("syncedAccount");
    if (!id) return;
    setBusy(true);
    setFileName("Live Sync account");
    fetch(`/api/private/live-sync/analyze?accountId=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (r) => {
        const json = await r.json().catch(() => null);
        if (!r.ok) throw new Error(json?.error?.message ?? "The synced account could not be analyzed.");
        setRes(json.data as EdgeAnalyzeResponse);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "The synced account could not be analyzed."))
      .finally(() => setBusy(false));
  }, []);

  async function analyze(file: File) {
    setBusy(true);
    setError(null);
    setRes(null);
    setFileName(file.name);
    try {
      const { body, gzip } = await gzipFile(file);
      const r = await fetch("/api/private/edge-analyzer/analyze", {
        method: "POST",
        headers: { "x-file-name": encodeURIComponent(file.name), ...(gzip ? { "x-upload-encoding": "gzip" } : {}), ...(saveIt ? { "x-save-analysis": "1" } : {}) },
        body,
      });
      const json = await r.json().catch(() => null);
      if (!r.ok) throw new Error(json?.error?.message ?? "The report could not be analyzed.");
      setRes(json.data as EdgeAnalyzeResponse);
      if ((json.data as EdgeAnalyzeResponse).saved) void loadSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The report could not be analyzed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const [pdfBusy, setPdfBusy] = useState(false);

  /** Builds the PDF in THIS browser from the report already on screen; nothing is uploaded or stored. */
  async function downloadPdf() {
    if (res?.access !== "full") return;
    setPdfBusy(true);
    try {
      const { renderReportPdf } = await import("@/services/edge-analyzer/pdf/render");
      const bytes = await renderReportPdf(res.report);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      // The uploaded file name is deliberately not used: it often contains the account number.
      a.download = `AT24-edge-report-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      setError("The PDF could not be created. Please try again.");
    } finally {
      setPdfBusy(false);
    }
  }

  const report = res?.report ?? null;
  const full = res?.access === "full" ? res.report : null;
  const locked = res?.access === "free" ? res.locked : null;
  const cur = report?.meta.currency ?? null;
  const c = report?.core;
  const e = report?.edge;
  const passed = report ? report.reconciliation.filter((x) => x.ok).length : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="INTELLIGENCE"
        title="Edge Analyzer"
        description="Upload your MetaTrader 5 trade history to see where your results really come from, whether they can be told apart from luck, and how much risk the history implies."
      />

      <Card className="space-y-3">
        <p className="text-sm font-semibold text-text">1. Export your report from MetaTrader 5</p>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-text-2">
          <li>Open the <b>History</b> tab in the terminal (Toolbox) and choose the period you want.</li>
          <li>Right-click the list → <b>Report</b> → <b>HTML</b>, and save the file.</li>
          <li>Upload it below. Use the English MT5 report.</li>
        </ol>
        <p className="text-xs text-text-3">
          Your file is analyzed in memory and is <b>not saved</b>. Account number, name and broker details are never read. Results describe the past only and are not investment advice. <Link href="/dashboard/help/edge-analyzer" className="font-semibold text-gold hover:underline">How to read the report →</Link>
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".html,.htm,text/html"
          className="hidden"
          onChange={(ev) => {
            const f = ev.target.files?.[0];
            if (f) void analyze(f);
          }}
        />
        <label className="flex items-start gap-2 text-sm text-text-2">
          <input type="checkbox" checked={saveIt} onChange={(ev) => setSaveIt(ev.target.checked)} className="mt-1" />
          <span>
            Save this analysis to my account so my AI tools (MCP) can use it. <span className="text-xs text-text-3">Paid plans. Only the analysis is stored, never the report file or individual trades. You can delete it anytime.</span>
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => inputRef.current?.click()} loading={busy}>{report ? "Analyze another report" : "Choose report file"}</Button>
          {fileName && !busy && <span className="text-xs text-text-3">{fileName}</span>}
          {busy && <span className="text-xs text-text-3">Analyzing…</span>}
        </div>
      </Card>

      {error && <Alert tone="danger">{error}</Alert>}
      {res?.saved && <Alert tone="success">Saved to your account. Your AI tools can now read it.</Alert>}
      {res?.saveNote && <Alert tone="info">{res.saveNote}</Alert>}

      {savedList.length > 0 && (
        <Card className="space-y-3">
          <p className="text-sm font-semibold text-text">Saved analyses</p>
          <ul className="divide-y divide-border">
            {savedList.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="text-text-2">
                  {new Date(a.createdAt).toLocaleString()} · {a.tradeCount} trades ·{" "}
                  <Badge tone={LEVEL_TONE[a.level as EdgeLevel] ?? "neutral"} className="normal-case">{LEVEL_LABEL[a.level as EdgeLevel] ?? a.level}</Badge>
                </span>
                <Button size="sm" variant="secondary" onClick={() => void deleteSaved(a.id)}>Delete</Button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-text-3">Your AI tools (MCP) read your most recent saved analysis. Deleting removes it permanently.</p>
        </Card>
      )}

      {report && c && e && (
        <>
          <Card className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={LEVEL_TONE[e.level]} className="normal-case">{LEVEL_LABEL[e.level]}</Badge>
              {report.reconciliation.length > 0 && (
                <Badge tone={report.reconciled ? "success" : "warning"} className="normal-case">
                  {report.reconciled ? `Matches your terminal's own summary (${passed}/${report.reconciliation.length} checks)` : "Does not fully match the terminal summary"}
                </Badge>
              )}
              {report.meta.accountMode && <Badge tone="neutral" className="normal-case">{report.meta.accountMode} account</Badge>}
              {locked && <Badge tone="gold" className="normal-case">Free summary</Badge>}
            </div>
            <p className="text-base text-text">{e.headline}</p>
            <ul className="list-disc space-y-1 pl-5 text-xs text-text-3">
              {e.caveats.map((t) => <li key={t}>{t}</li>)}
            </ul>
            {full && (
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" variant="secondary" onClick={() => void downloadPdf()} loading={pdfBusy}>Download PDF</Button>
                <span className="text-xs text-text-3">Created in your browser. The report is not uploaded or stored.</span>
              </div>
            )}
          </Card>

          {report.warnings.map((w) => <Alert key={w} tone="warning">{w}</Alert>)}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Net profit" value={money(c.netProfit, cur)} />
            <StatCard label="Closed trades" value={c.tradeCount} />
            <StatCard label="Win rate" value={pct(c.winRatePct)} hint="Share of trades with a profit above zero. Break-even trades are not counted as wins." />
            <StatCard label="Profit factor" value={c.profitFactor === null ? "-" : c.profitFactor.toFixed(2)} hint="Gross profit divided by gross loss." />
            <StatCard label="Avg result / trade" value={money(c.expectancy, cur)} hint="Average net result per closed trade (profit + commission + swap)." />
            <StatCard label="Payoff ratio" value={c.payoffRatio === null ? "-" : c.payoffRatio.toFixed(2)} hint="Average win divided by average loss." />
            <StatCard label="Max drawdown" value={`${pct(c.maxDrawdownPct)}`} hint={`Largest peak-to-trough fall of the balance: ${money(c.maxDrawdownAbs, cur)}.`} />
            <StatCard label="Longest losing streak" value={c.maxConsecutiveLosses} />
          </div>

          {locked && (
            <Card className="space-y-3 border-gold/40">
              <p className="text-sm font-semibold text-text">Unlock the full report</p>
              <p className="text-sm text-text-2">The free summary shows your headline verdict, key numbers and three breakdowns. An active paid plan also includes:</p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-text-2">
                {locked.map((s) => <li key={s}>{s}</li>)}
              </ul>
              <ButtonLink href="/dashboard/billing" size="sm">See plans</ButtonLink>
            </Card>
          )}

          {full && (
            <Card className="space-y-3">
              <p className="text-sm font-semibold text-text">Is it skill or luck?</p>
              <ul className="space-y-1 text-sm text-text-2">
                <li>Average result per trade: <b className="text-text">{money(full.edge.mean, cur)}</b>, 95% range <b className="text-text">{money(full.edge.ci95[0], cur)} to {money(full.edge.ci95[1], cur)}</b></li>
                <li>Chance of seeing a result this far from zero by luck alone (p-value): <b className="text-text">{full.edge.pValue}</b></li>
                <li>Trades needed to tell this average from zero at the current variance: <b className="text-text">{full.edge.tradesNeeded ?? "n/a"}</b> (you have {full.edge.n})</li>
                <li>Trades overlapping in time: <b className="text-text">{pct(full.edge.overlapPct)}</b> · lag-1 autocorrelation: <b className="text-text">{full.edge.lag1Autocorrelation ?? "-"}</b></li>
                {full.edge.perLot && <li>Result per lot (position-size sensitivity): <b className="text-text">{LEVEL_LABEL[full.edge.perLot.level]}</b> (average {money(full.edge.perLot.mean, cur)}, range {money(full.edge.perLot.ci95[0], cur)} to {money(full.edge.perLot.ci95[1], cur)})</li>}
              </ul>
              <p className="text-xs text-text-3">This is a level of evidence from your past trades, not proof and not a validation of any strategy.</p>
            </Card>
          )}

          {full?.ruin && (
            <Card className="space-y-3">
              <p className="text-sm font-semibold text-text">What could the next {full.ruin.scenarios[0]?.horizonTrades} trades look like?</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-left text-sm">
                  <thead className="text-xs text-text-3">
                    <tr>
                      <th className="py-1 pr-3">Scenario</th>
                      <th className="py-1 pr-3">Drawdown ≥20%</th>
                      <th className="py-1 pr-3">≥30%</th>
                      <th className="py-1 pr-3">≥50%</th>
                      <th className="py-1 pr-3">Ends below start</th>
                      <th className="py-1">Balance (5% / median / 95%)</th>
                    </tr>
                  </thead>
                  <tbody className="text-text-2">
                    {full.ruin.scenarios.map((s) => (
                      <tr key={s.name} className="border-t border-border">
                        <td className="py-2 pr-3 text-text">{s.name === "independent" ? "Trades independent" : "Keeps winning/losing streaks"}</td>
                        {s.probDrawdownReaches.map((p) => <td key={p.thresholdPct} className="py-2 pr-3">{prob(p.probability)}</td>)}
                        <td className="py-2 pr-3">{prob(s.probFinishBelowStart)}</td>
                        <td className="py-2 fin-num">{money(s.finalBalancePercentiles.p5, null)} / {money(s.finalBalancePercentiles.p50, null)} / {money(s.finalBalancePercentiles.p95, null)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-text-3">Your own past trades were resampled thousands of times. The streak scenario is the more cautious reading. This illustrates risk; it is not a forecast.</p>
              <ul className="list-disc space-y-1 pl-5 text-xs text-text-3">
                {full.ruin.assumptions.map((a) => <li key={a}>{a}</li>)}
              </ul>
            </Card>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {report.patterns.byTag.length > 1 && <BarList title="By strategy / EA tag (trade comment)" rows={report.patterns.byTag} cur={cur} sort="net" />}
            <BarList title="By symbol" rows={report.patterns.bySymbol} cur={cur} sort="net" />
            <BarList title="By day of week (broker time)" rows={report.patterns.byWeekday} cur={cur} />
            {full && <BarList title="By direction" rows={full.patterns.byDirection} cur={cur} />}
            {full && <BarList title="By hour of day (broker time)" rows={full.patterns.byHour} cur={cur} />}
            {full && <BarList title="By how long trades were held" rows={full.patterns.byHoldTime} cur={cur} />}
          </div>

          {full && (
            <Card className="space-y-2">
              <p className="text-sm font-semibold text-text">Habits worth a closer look</p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-text-2">
                {full.patterns.sizeAfterOutcome.ratio !== null && (
                  <li>
                    Average lot size after a loss: <b className="text-text">{full.patterns.sizeAfterOutcome.avgVolumeAfterLoss}</b> vs after a win: <b className="text-text">{full.patterns.sizeAfterOutcome.avgVolumeAfterWin}</b> (×{full.patterns.sizeAfterOutcome.ratio}).
                    {full.patterns.sizeAfterOutcome.ratio >= 1.2 ? " You tend to size up after losses." : full.patterns.sizeAfterOutcome.ratio <= 0.83 ? " You tend to size down after losses." : " Sizing is similar after wins and losses."}
                  </li>
                )}
                <li>Average time held: winners <b className="text-text">{minutes(c.avgHoldMsWinners)}</b>, losers <b className="text-text">{minutes(c.avgHoldMsLosers)}</b>.</li>
                <li>Longest run: <b className="text-text">{c.maxConsecutiveWins}</b> wins in a row, <b className="text-text">{c.maxConsecutiveLosses}</b> losses in a row.</li>
              </ul>
              <p className="text-xs text-text-3">These are observations to investigate, not instructions. Small groups ("few trades") should not be read into.</p>
            </Card>
          )}

          <Card className="space-y-2">
            <p className="text-sm font-semibold text-text">How to read this report</p>
            <ul className="list-disc space-y-1 pl-5 text-xs text-text-3">
              {report.assumptions.map((a) => <li key={a}>{a}</li>)}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
