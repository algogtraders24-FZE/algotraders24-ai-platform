# M2 — Backtest Evidence Engine

**Status:** M2.1 (real MT5 evidence ingestion) complete — engine has now produced a genuine, verified Evidence record from the real G01 v0.1 frozen baseline. See §6.

**Scope discipline (per the M1 approval note):** M2 answers *"what actually happened under these precisely documented test conditions?"* — it does not decide whether a system is good, verified, or marketplace-worthy. No statistical-validity judgment, no OOS/walk-forward, no curve-fit screening, no score. Those are M4/M5/M6. This engine's only job is: raw backtest artifacts in → one immutable `Evidence` record (+ `Trade` records) conforming exactly to the [M1 schema](../M1_schema.prisma), out.

---

## 1. Pipeline (as specified at M1 approval)

```
Backtest artifacts (native .htm report + trade-level CSV)
      ↓
Data Integrity          — is the raw input itself structurally sound?
      ↓
Execution/Cost Conditions — what conditions produced these numbers?
      ↓
Trade Generation         — normalize raw rows into canonical Trade records
      ↓
Performance Calculation  — recompute metrics independently from the trade list
      ↓
Evidence Record          — assemble the M1-conformant JSON
      ↓
Immutable Provenance     — content-hash, write-once, refuse silent overwrite
```

## 2. Stage detail

### 2.1 Data Integrity (structural, not statistical)
This is deliberately narrow — it checks that the *raw feed* is usable, not that the *strategy* is valid (that's M4's `DATA_INTEGRITY` Validation layer, which judges the Evidence after it exists). Checks performed:
- Required CSV columns present; report file parses as HTML with a recognizable settings/results structure.
- No duplicate `(timestamp, entry)` trade rows.
- Timestamps parse and are non-decreasing (or explicitly out-of-order, flagged rather than silently sorted).
- No NaN/negative prices, non-finite R-multiples, or empty required fields.
- Trade count above zero (a zero-trade file fails integrity outright — it cannot become Evidence, only a recorded integrity failure).

A failed integrity check **halts the pipeline** — it never proceeds to produce a partial or best-effort Evidence record. This mirrors principle 2 from M0.1: Evidence is either real and reproducible, or it doesn't exist yet.

### 2.2 Execution/Cost Conditions
Extracted from the native MT5 `.htm` report's settings block: symbol, timeframe/period, broker/company, currency, initial deposit, leverage, modeling/tick-data quality, and — where present — spread/commission/swap assumptions. These become the `provenance` object required by every `Evidence` row (M1 §2, "no metric without its conditions attached"). If the report doesn't expose a field (e.g. MT5 reports don't always surface an explicit commission line when it's zero), the field is recorded as `null`, never guessed.

### 2.3 Trade Generation
Each raw CSV row is mapped into a canonical `Trade` shape (`timestamp, symbol, direction, entryPrice, exitPrice, sl, tp, volume, profit, rMultiple, durationSeconds, marketRegime`). The current adapter (`parse_g01_research_csv`) is written specifically for G01's Phase-research CSV format (`AT24_G01_ResearchLog.csv` — has `R_multiple`, `mae_R`/`mfe_R`, latency fields, `exit_reason` rather than a raw MT5 trade-history export). It is explicitly one adapter, not the only one — a different source (e.g. MT5's own trade-history CSV export, or a future third-party seller's format) needs its own adapter function producing the same canonical shape, which is why parsing and metric computation are kept as separate functions rather than one monolithic script.

### 2.4 Performance Calculation
Metrics are **recomputed from the trade list**, not copied from the .htm report's own summary — the report's summary is used only as a cross-check (logged as a warning, not a failure, if it disagrees beyond floating-point tolerance, since a disagreement itself is useful evidence-quality information). Formulas:
- `netProfit` = Σ profit
- `profitFactor` = Σ(profit where profit>0) / |Σ(profit where profit<0)|
- `winRate` = count(profit>0) / count(trades)
- `avgTrade` = netProfit / count(trades)
- `maxDrawdown` = max peak-to-trough decline of the cumulative-profit equity curve (both in currency and %)
- `recoveryFactor` = netProfit / maxDrawdown(currency)
- `sharpe` / `sortino` = mean(trade returns) / stdev(trade returns) [Sortino uses downside deviation only], **not annualized** — annualization requires a trading-frequency assumption this engine does not make; if annualized figures are wanted later that's a presentation-layer decision, not baked into Evidence
- `expectedPayoff` = avgTrade (kept as a separate named field since MT5 reports label it distinctly)
- `largestWin` / `largestLoss`, `consecutiveWins` / `consecutiveLosses` — direct scan of the trade sequence
- `tradeCount` = count(trades)

### 2.5 Evidence Record + Immutable Provenance
Fields are assembled into the exact shape of `Evidence` + `Trade[]` from `M1_schema.prisma`, plus:
- `generatedBy = "AT24-M2-Evidence-Engine-v0.2"` (named, versioned — required by the M1 contract)
- `sourceAdapter` — which trade-log source produced this Evidence: `"g01-research-csv-v1"` or `"mt5-deals-table-v1"` (M2.1)
- a SHA-256 content hash of the finished record, used as part of the output filename
- the writer refuses to overwrite an existing output file for the same hash — the closest a flat-file prototype can get to enforcing "immutable once generated" ahead of a real database with row-level write permissions

---

## 3. What this engine explicitly does NOT do

- Does not judge statistical validity, sample-size sufficiency, or robustness (M4/M5).
- Does not assign a `TrustStatus` or `Score` (M6/M7).
- Does not decide whether a system is publishable (M9).
- Does not annualize or otherwise "dress up" any metric beyond the raw recomputation in §2.4.

---

## 4. Files

- `evidence_engine.py` — the pipeline (parsing, integrity checks, metrics, assembly, immutable write), stdlib-only Python, runnable as a CLI. Two source adapters share the same integrity/metrics/assembly code: `parse_g01_research_csv` (original M2) and `parse_mt5_deals_table` + `reconcile_deals_to_trades` (M2.1).
- `test_fixtures/` — **synthetic, clearly-labeled test data only**, used to prove the CSV-adapter code is correct. Never presented as real G01 performance. See the fixture files' own header comments.
- `test_engine.py` — synthetic-fixture self-tests (original M2).
- `test_real_data.py` — M2.1's real-data test suite, run against the genuine archived v0.1 report (see §6).
- `real_evidence_output/` — the actual, real, immutable Evidence record produced from the genuine G01 v0.1 baseline (§6). Not a fixture.

Usage:
```
# Original CSV-adapter path:
python evidence_engine.py --report <report.htm> --tradelog <AT24_G01_ResearchLog.csv> --version-id <id> --out-dir <dir>

# M2.1 deals-table path (no separate trade-log needed):
python evidence_engine.py --report <report.htm> --source deals --version-id <id> --out-dir <dir>
```

---

## 5. Superseded: the original "no real dataset" gap

The first version of this document flagged that no real G01 backtest artifact was available to run the engine against. That was true only for the git repo and the *live* MetaQuotes CSV (both empty/absent). A search of the MT5 terminal's own data folder (outside this repo) found the genuine archived native report from the actual v0.1 baseline run, `G01_Baseline_v0.1_Report.htm` — see §6, which supersedes this section.

---

## 6. M2.1 — Real MT5 Evidence Ingestion (done)

**What changed:** instead of requiring a separate trade-log CSV, the engine can now reconstruct full trade-level Evidence directly from a native MT5 report's own **Deals** table — every entry/exit deal MT5 itself recorded during the run. This matters because a run's CSV trade-log frequently doesn't survive (the shared file gets overwritten by the next `OnInit`), while the `.htm` report — saved with a unique name — often does.

**Real bugs found and fixed by actually running this against genuine data** (not found by synthetic fixtures alone — this is exactly why real-data testing was in scope):
1. **MT5 reports are UTF-16LE, not UTF-8.** Reading as UTF-8 doesn't raise an error — it silently decodes to garbage. Fixed by sniffing the byte-order mark before decoding (`_read_html_text`), with a clean `ValueError` halt if neither a UTF-16 BOM nor valid UTF-8 is found.
2. **Max-drawdown % was computed against the wrong baseline.** It measured drawdown as a fraction of peak *cumulative profit*, not peak *account equity* (deposit + cumulative profit) — for a losing strategy whose profit curve stays small before a large pullback, this wildly overstates the percentage (an early version of this run reported 6233% drawdown against a real 63.01%). Fixed by folding the initial deposit into the equity curve before computing drawdown.
3. **The settings parser was reading itself the whole report**, including the giant Deals table further down. That table's own column-header row (`Time, Deal, Symbol, Type, Direction, ...`) parses as valid label/value pairs under the same generic heuristic used for the Settings section, and `Symbol → Type` silently overwrote the real `Symbol: XAUUSD` pair (found by inspecting actual output — `provenance.symbol` came back `"Type"`). Fixed by bounding the settings parser to the text before the Orders/Deals tables begin.

**Verification run — genuine G01 v0.1 frozen baseline** (`G01_Baseline_v0.1_Report.htm`, sha256 `30f35bcd...`, 2017.01.01–2026.08.15, XAUUSD M5, every real tick, ~398M ticks, Raw Trading Ltd / ICMarketsSC-Demo):

| Metric | AT24 computed | MT5 report | Delta | Note |
|---|---|---|---|---|
| Net Profit | -5909.32 | -5909.32 | 0.00 | Exact match |
| Trade Count | 2712 | 2712 | 0 | Exact match |
| Max Drawdown % | 63.01% | 63.01% | 0.00 | Exact match (after bug #2 fix) |
| Profit Factor | 0.8876 | 0.89 | -0.0024 | Matches at reported precision |
| Win Rate | 33.48% | 33.52% | -0.04pp | Net-of-cost vs. MT5's gross classification — 1 trade flips win→loss after commission |
| Largest Win | 120.08 | 120.96 | -0.88 | AT24 is net of commission/swap; MT5's figure is gross |
| Largest Loss | -141.97 | -140.11 | -1.86 | Same gross-vs-net distinction |
| Sharpe | -0.0524 | -1.69 | large | Not expected to match — AT24's is per-trade, unannualized; MT5's uses its own return-interval convention |

Every difference above is either an exact match or has a specific, reported, methodologically-explained cause — none are hidden or forced to align, per the sprint's explicit requirement. The win-rate/largest-win/largest-loss deltas are, if anything, evidence *for* AT24's thesis: MT5's own headline figures are gross of trading cost, and AT24's net-of-cost figures are the more honest ones (M0.1 principle 7; M0 research gap #7).

**5,424 deals → 2,712 trades:** confirmed clean 1-for-1 pairing (2,712 `buy` + 2,712 `sell` = 5,424; 2,712 `in` + 2,712 `out`, strictly alternating, zero unmatched positions) — reconciliation used a per-symbol FIFO queue (not naive fixed-offset pairing) and validates volume-matching on every pair; any mismatch halts with a listed reason rather than guessing.

**Real-data tests** (`test_real_data.py`, all passing against the genuine file, not synthetic fixtures):
1. Genuine v0.1 report → full pipeline succeeds, cross-check table above generated and printed.
2. Corrupted report (real file truncated mid-Deals-table) → clean `ValueError` halt.
3. Encoding failure (invalid byte sequence) → clean `ValueError` halt, doesn't silently decode garbage.
4. Malformed Deals table (12 columns instead of 13, missing Direction) → clean `ValueError` halt.
5. Immutability → second run against the identical real report refuses to overwrite (`FileExistsError`).

**Output:** `real_evidence_output/evidence_G01-v0.1-FROZEN-BASELINE_*.json` — the actual, real, immutable Evidence + 2,712 Trade records for the G01 v0.1 frozen baseline. Source artifact (`G01_Baseline_v0.1_Report.htm`) was only ever read, never modified, and is referenced by name + full SHA-256 hash in `provenance.dataSource`, not copied into this repo (it lives on the research machine's MT5 terminal data folder).
