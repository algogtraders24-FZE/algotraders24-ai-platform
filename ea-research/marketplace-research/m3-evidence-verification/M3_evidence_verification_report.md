# M3 Evidence Verification Report

**Generated:** 2026-08-19T13:55:16.426885Z  
**Verifier version:** AT24-M3-Evidence-Verifier-v1.0  
**Evidence package:** `E:\algotraders24-ai-platform\ea-research\marketplace-research\m2-evidence-engine\real_evidence_output\evidence_G01-v0.1-FROZEN-BASELINE_1d0d5df55c44a8a1.json`  
**Source artifact:** `C:\Users\om\AppData\Roaming\MetaQuotes\Terminal\8762A67661860246215827420BCD27F8\G01_Baseline_v0.1_Report.htm`

This report is read-only output: neither the Evidence package nor the source artifact was modified to produce it. See `M3_evidence_integrity_verification.md` for the full contract and the two documented judgment calls (Evidence ID = content hash; TradingSystem ID resolved via `version_registry.json`, not stored redundantly on Evidence) that this report's PASS/FAIL calls rely on.

## Identity

- Evidence ID (content hash): `1d0d5df55c44a8a1`
- TradingSystem: `G01` — G01 LiquiditySweep MSS FVG (Gold Auto Strategy)
- Version: `G01-v0.1-FROZEN-BASELINE` (v0.1)
- Evidence type: HISTORICAL / BACKTEST (adapter: mt5-deals-table-v1)
- Source artifact SHA-256: `30f35bcd369cbb7fe54f2837411bad69fe40b0f79a6890130f8721f3d6cbe883`
- Generator: AT24-M2-Evidence-Engine-v0.2
- Created: 2026-08-19T13:35:55.862269Z
- Trade count: 2712

## Checks

| Check | Result |
|---|---|
| Source Integrity | PASS |
| Provenance | PASS |
| Trade Integrity | PASS |
| Metric Integrity | PASS |
| Version Binding | PASS |
| Hash Integrity | PASS |

## Final Status

**VERIFIED**

## Failures

None.

## Warnings (accepted, non-blocking — see contract doc section 3)

- PROVENANCE_NOT_AVAILABLE (accepted, source doesn't expose it): 'spreadModel' is null
- PROVENANCE_NOT_AVAILABLE (accepted, source doesn't expose it): 'commissionModel' is null
- PROVENANCE_NOT_AVAILABLE (accepted, source doesn't expose it): 'swapModel' is null
- PROVENANCE_NOT_AVAILABLE (accepted, source doesn't expose it): 'tickDataQuality' is null

## What this status does and does not mean

`VERIFIED` means: this Evidence's identity is complete, its provenance meets the hard-required minimum (with the specific soft-required gaps disclosed above, not hidden), its trade records are internally consistent and reconcile against its own stored metrics within tolerance, it is bound to the Version it claims, its content hash matches what was generated, and its source artifact's current SHA-256 still matches what the Evidence recorded at generation time.

`VERIFIED` does **not** mean this trading system is profitable, robust, statistically significant, or fit for listing — those are M4 (Validation), M5 (Robustness), M6 (Score), and M7 (Trust Status), none of which have run yet.
