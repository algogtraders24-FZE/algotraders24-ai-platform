"""
M3.9 + M3.10: runs the verifier against the REAL M2.1 G01 Evidence package
(not synthetic) and writes M3_evidence_verification_report.md. Read-only --
touches neither the Evidence package nor the original .htm report.

Run: python run_real_verification.py
"""

import json
from pathlib import Path

from evidence_verifier import load_evidence_package, verify_evidence_package

HERE = Path(__file__).parent
REAL_EVIDENCE_DIR = HERE.parent / "m2-evidence-engine" / "real_evidence_output"
SOURCE_ARTIFACT = Path(
    r"C:\Users\om\AppData\Roaming\MetaQuotes\Terminal\8762A67661860246215827420BCD27F8\G01_Baseline_v0.1_Report.htm"
)
EXPECTED_VERSION_ID = "G01-v0.1-FROZEN-BASELINE"
REGISTRY = HERE / "version_registry.json"


def find_real_evidence_file() -> Path:
    matches = sorted(REAL_EVIDENCE_DIR.glob("evidence_*.json"))
    if not matches:
        raise FileNotFoundError(f"No Evidence package found in {REAL_EVIDENCE_DIR} -- run M2's pipeline first.")
    return matches[0]


def render_report(evidence_path: Path, result, evidence: dict, trades: list) -> str:
    registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
    reg_entry = registry.get(evidence.get("versionId"), {})
    check = lambda ok: "PASS" if ok else ("N/A" if ok is None else "FAIL")  # noqa: E731

    lines = [
        "# M3 Evidence Verification Report",
        "",
        f"**Generated:** {result.verifiedAt}  ",
        f"**Verifier version:** {result.verifierVersion}  ",
        f"**Evidence package:** `{evidence_path}`  ",
        f"**Source artifact:** `{SOURCE_ARTIFACT}`",
        "",
        "This report is read-only output: neither the Evidence package nor the source artifact was modified to produce it. See `M3_evidence_integrity_verification.md` for the full contract and the two documented judgment calls (Evidence ID = content hash; TradingSystem ID resolved via `version_registry.json`, not stored redundantly on Evidence) that this report's PASS/FAIL calls rely on.",
        "",
        "## Identity",
        "",
        f"- Evidence ID (content hash): `{result.evidenceId}`",
        f"- TradingSystem: `{reg_entry.get('tradingSystemId', 'UNRESOLVED')}` — {reg_entry.get('tradingSystemName', '?')}",
        f"- Version: `{evidence.get('versionId')}` ({reg_entry.get('versionString', '?')})",
        f"- Evidence type: {evidence.get('evidenceClass')} / {evidence.get('source')} (adapter: {evidence.get('sourceAdapter')})",
        f"- Source artifact SHA-256: `{evidence.get('provenance', {}).get('dataSource', {}).get('reportFileSha256')}`",
        f"- Generator: {evidence.get('generatedBy')}",
        f"- Created: {evidence.get('createdAt')}",
        f"- Trade count: {len(trades)}",
        "",
        "## Checks",
        "",
        "| Check | Result |",
        "|---|---|",
        f"| Source Integrity | {check(result.sourceArtifactVerified)} |",
        f"| Provenance | {check(result.provenanceVerified)} |",
        f"| Trade Integrity | {check(result.tradeIntegrityVerified)} |",
        f"| Metric Integrity | {check(result.metricIntegrityVerified)} |",
        f"| Version Binding | {check(result.versionBindingVerified)} |",
        f"| Hash Integrity | {check(result.hashVerified)} |",
        "",
        "## Final Status",
        "",
        f"**{result.status}**",
        "",
    ]

    if result.failures:
        lines += ["## Failures", ""]
        lines += [f"- {f}" for f in result.failures]
        lines += [""]
    else:
        lines += ["## Failures", "", "None.", ""]

    if result.warnings:
        lines += [
            "## Warnings (accepted, non-blocking — see contract doc section 3)",
            "",
        ]
        lines += [f"- {w}" for w in result.warnings]
        lines += [""]

    lines += [
        "## What this status does and does not mean",
        "",
        "`VERIFIED` means: this Evidence's identity is complete, its provenance meets the hard-required minimum (with the specific soft-required gaps disclosed above, not hidden), its trade records are internally consistent and reconcile against its own stored metrics within tolerance, it is bound to the Version it claims, its content hash matches what was generated, and its source artifact's current SHA-256 still matches what the Evidence recorded at generation time.",
        "",
        "`VERIFIED` does **not** mean this trading system is profitable, robust, statistically significant, or fit for listing — those are M4 (Validation), M5 (Robustness), M6 (Score), and M7 (Trust Status), none of which have run yet.",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    evidence_path = find_real_evidence_file()
    result = verify_evidence_package(
        evidence_path,
        source_artifact_path=SOURCE_ARTIFACT,
        expected_version_id=EXPECTED_VERSION_ID,
        registry_path=REGISTRY,
    )
    evidence, trades = load_evidence_package(evidence_path)

    report = render_report(evidence_path, result, evidence, trades)
    out_path = HERE / "M3_evidence_verification_report.md"
    out_path.write_text(report, encoding="utf-8")

    print(f"Status: {result.status}")
    print(f"Report written: {out_path}")
    if result.failures:
        print("Failures:")
        for f in result.failures:
            print(f"  - {f}")


if __name__ == "__main__":
    main()
