"""
M3 -- Evidence Integrity & Verification Layer (AT24 Marketplace program).

Verifies a single Evidence package (M2's output: {"evidence": {...}, "trades":
[...]}) for internal consistency, traceability to its source artifact, and
correct version binding. Read-only: never modifies the Evidence package or
the original source artifact, never regenerates or "fixes" anything.

Explicitly OUT of scope (see M3_evidence_integrity_verification.md): no
statistical validity, no OOS/WFA, no robustness, no Trust Status, no Score,
no profitability judgment. status is only ever VERIFIED or FAILED.

Stdlib-only. Reuses M2's compute_metrics for reconciliation (see the design
doc section 6 for why reuse, rather than a second formula implementation, is
the correct choice here).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent.parent / "m2-evidence-engine"))
from evidence_engine import compute_metrics  # noqa: E402  (sibling-package import, see above)

VERIFIER_VERSION = "AT24-M3-Evidence-Verifier-v1.0"

HARD_REQUIRED_PROVENANCE = [
    ("dataSource.reportFile", lambda p: p.get("dataSource", {}).get("reportFile")),
    ("dataSource.reportFileSha256", lambda p: p.get("dataSource", {}).get("reportFileSha256")),
    ("broker", lambda p: p.get("broker")),
    ("symbol", lambda p: p.get("symbol")),
    ("timeframe", lambda p: p.get("timeframe")),
    ("periodStart", lambda p: p.get("periodStart")),
    ("periodEnd", lambda p: p.get("periodEnd")),
    ("executionAssumptions.initialDeposit", lambda p: p.get("executionAssumptions", {}).get("initialDeposit")),
]
SOFT_REQUIRED_PROVENANCE = ["spreadModel", "commissionModel", "swapModel", "tickDataQuality"]

REQUIRED_TRADE_FIELDS = ["timestamp", "symbol", "direction", "entryPrice", "exitPrice", "volume", "profit"]
VALID_DIRECTIONS = {"long", "short", "buy", "sell"}


@dataclass
class EvidenceVerification:
    evidenceId: str
    verifiedAt: str
    verifierVersion: str
    sourceArtifactVerified: bool | None
    provenanceVerified: bool
    tradeIntegrityVerified: bool
    metricIntegrityVerified: bool
    versionBindingVerified: bool
    hashVerified: bool
    status: str  # "VERIFIED" | "FAILED"
    failures: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "evidenceId": self.evidenceId,
            "verifiedAt": self.verifiedAt,
            "verifierVersion": self.verifierVersion,
            "sourceArtifactVerified": self.sourceArtifactVerified,
            "provenanceVerified": self.provenanceVerified,
            "tradeIntegrityVerified": self.tradeIntegrityVerified,
            "metricIntegrityVerified": self.metricIntegrityVerified,
            "versionBindingVerified": self.versionBindingVerified,
            "hashVerified": self.hashVerified,
            "status": self.status,
            "failures": self.failures,
            "warnings": self.warnings,
        }


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------


def load_evidence_package(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if "evidence" not in payload or "trades" not in payload:
        raise ValueError(f"{path} is not a valid Evidence package -- missing 'evidence' or 'trades' key")
    return payload["evidence"], payload["trades"]


def _file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# M3.2 -- Source artifact integrity
# ---------------------------------------------------------------------------


def verify_source_artifact(evidence: dict[str, Any], source_artifact_path: Path | None) -> tuple[bool | None, list[str]]:
    """Returns (None, [note]) -- not a failure -- if no current artifact path
    was supplied; the check simply couldn't be run, which is reported
    distinctly from having run it and found a mismatch."""
    claimed_hash = evidence.get("provenance", {}).get("dataSource", {}).get("reportFileSha256")
    if source_artifact_path is None:
        return None, []
    if not source_artifact_path.exists():
        return False, [f"SOURCE_ARTIFACT_MISSING: {source_artifact_path} does not exist"]
    current_hash = _file_sha256(source_artifact_path)
    if claimed_hash is None:
        return False, ["SOURCE_ARTIFACT_MISMATCH: Evidence has no recorded source SHA-256 to compare against"]
    if current_hash != claimed_hash:
        return False, [f"SOURCE_ARTIFACT_MISMATCH: current sha256={current_hash} != Evidence.provenance sha256={claimed_hash}"]
    return True, []


# ---------------------------------------------------------------------------
# M3.1 (identity) + provenance completeness
# ---------------------------------------------------------------------------


def verify_identity_and_provenance(evidence: dict[str, Any], registry: dict[str, Any]) -> tuple[bool, list[str], list[str]]:
    failures: list[str] = []
    warnings: list[str] = []

    if not evidence.get("_contentHash"):
        failures.append("IDENTITY_MISSING: no _contentHash (Evidence ID) present")
    if not evidence.get("versionId"):
        failures.append("IDENTITY_MISSING: no versionId present")
    if not evidence.get("evidenceClass"):
        failures.append("IDENTITY_MISSING: no evidenceClass (Evidence type) present")
    if not evidence.get("generatedBy"):
        failures.append("IDENTITY_MISSING: no generatedBy (generator/adapter+version) present")
    if not evidence.get("createdAt"):
        failures.append("IDENTITY_MISSING: no createdAt present")

    version_id = evidence.get("versionId")
    if version_id and version_id not in registry:
        failures.append(f"TRADING_SYSTEM_UNRESOLVED: versionId '{version_id}' has no entry in version_registry.json -- cannot resolve TradingSystem ID")

    provenance = evidence.get("provenance", {})
    for label, getter in HARD_REQUIRED_PROVENANCE:
        value = getter(provenance)
        if value is None or value == "":
            failures.append(f"PROVENANCE_MISSING (required): {label}")

    for field_name in SOFT_REQUIRED_PROVENANCE:
        if field_name not in provenance:
            failures.append(f"PROVENANCE_FIELD_ABSENT: '{field_name}' key missing entirely from provenance (must exist, even if null)")
        elif provenance[field_name] is None:
            warnings.append(f"PROVENANCE_NOT_AVAILABLE (accepted, source doesn't expose it): '{field_name}' is null")

    return (len(failures) == 0), failures, warnings


# ---------------------------------------------------------------------------
# M3.3 -- Evidence <-> Trade consistency
# ---------------------------------------------------------------------------


def _trade_identity_key(trade: dict[str, Any]) -> Any:
    if trade.get("entryDealId") is not None and trade.get("exitDealId") is not None:
        return ("deal", trade["entryDealId"], trade["exitDealId"])
    return ("composite", trade.get("timestamp"), trade.get("symbol"), trade.get("entryPrice"), trade.get("exitPrice"), trade.get("volume"))


def verify_trade_consistency(evidence: dict[str, Any], trades: list[dict[str, Any]]) -> tuple[bool, list[str]]:
    failures: list[str] = []

    claimed_count = evidence.get("metricsSummary", {}).get("tradeCount")
    if claimed_count != len(trades):
        failures.append(f"TRADE_COUNT_MISMATCH: Evidence.metricsSummary.tradeCount={claimed_count} but {len(trades)} trade records present")

    seen_keys: set[Any] = set()
    for i, t in enumerate(trades):
        key = _trade_identity_key(t)
        if key in seen_keys:
            failures.append(f"DUPLICATE_TRADE: trade at index {i} duplicates identity key {key}")
        seen_keys.add(key)

        for req_field in REQUIRED_TRADE_FIELDS:
            if t.get(req_field) is None:
                failures.append(f"TRADE_FIELD_MISSING: trade at index {i} missing required field '{req_field}'")

        direction = t.get("direction")
        if direction is not None and direction not in VALID_DIRECTIONS:
            failures.append(f"TRADE_INVALID_DIRECTION: trade at index {i} has direction={direction!r}")

        volume = t.get("volume")
        if volume is not None and not (isinstance(volume, (int, float)) and volume > 0):
            failures.append(f"TRADE_INVALID_VOLUME: trade at index {i} has volume={volume!r}")

        for price_field in ("entryPrice", "exitPrice"):
            v = t.get(price_field)
            if v is not None and not (isinstance(v, (int, float)) and v > 0 and math.isfinite(v)):
                failures.append(f"TRADE_INVALID_PRICE: trade at index {i} field '{price_field}'={v!r}")

        profit = t.get("profit")
        if profit is not None and not (isinstance(profit, (int, float)) and math.isfinite(profit)):
            failures.append(f"TRADE_NONFINITE_PROFIT: trade at index {i} profit={profit!r}")

        duration = t.get("durationSeconds")
        if duration is not None and duration < 0:
            failures.append(f"TRADE_EXIT_BEFORE_ENTRY: trade at index {i} durationSeconds={duration} (negative -- exit precedes entry)")

        ts = t.get("timestamp")
        if ts is not None and _parse_ts(ts) is None:
            failures.append(f"TRADE_INVALID_TIMESTAMP: trade at index {i} timestamp={ts!r} unparseable")

    return (len(failures) == 0), failures


def _parse_ts(value: str) -> datetime | None:
    for fmt in ("%Y.%m.%d %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y.%m.%d %H:%M", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


# ---------------------------------------------------------------------------
# M3.4 -- Independent metric reconciliation
# ---------------------------------------------------------------------------


def verify_metric_reconciliation(evidence: dict[str, Any], trades: list[dict[str, Any]]) -> tuple[bool, list[str], dict[str, Any]]:
    stored = evidence.get("metricsSummary", {})
    try:
        deposit = evidence.get("provenance", {}).get("executionAssumptions", {}).get("initialDeposit")
        recomputed = compute_metrics(trades, initial_deposit=deposit)
    except Exception as e:
        return False, [f"METRIC_RECOMPUTATION_FAILED: {e}"], {}

    failures: list[str] = []
    comparison: dict[str, Any] = {}
    tolerances = {"netProfit": 0.01, "profitFactor": 0.01, "tradeCount": 0, "winRate": 0.0001}

    for key, tol in tolerances.items():
        stored_v = stored.get(key)
        recomputed_v = recomputed.get(key)
        delta = None
        ok = None
        if stored_v is not None and recomputed_v is not None:
            delta = round(stored_v - recomputed_v, 6)
            ok = abs(delta) <= tol
            if not ok:
                failures.append(f"METRIC_MISMATCH ({key}): stored={stored_v} recomputed={recomputed_v} delta={delta} exceeds tolerance {tol}")
        elif stored_v != recomputed_v:
            failures.append(f"METRIC_MISMATCH ({key}): stored={stored_v} recomputed={recomputed_v}")
        comparison[key] = {"stored": stored_v, "recomputed": recomputed_v, "delta": delta, "withinTolerance": ok}

    return (len(failures) == 0), failures, comparison


# ---------------------------------------------------------------------------
# M3.5 -- Version binding
# ---------------------------------------------------------------------------


def verify_version_binding(evidence: dict[str, Any], expected_version_id: str | None) -> tuple[bool, list[str]]:
    failures: list[str] = []
    version_id = evidence.get("versionId")
    if not version_id:
        failures.append("VERSION_BINDING_MISSING: Evidence has no versionId")
    elif expected_version_id is not None and version_id != expected_version_id:
        failures.append(f"VERSION_BINDING_MISMATCH: Evidence.versionId={version_id!r} != expected {expected_version_id!r}")
    return (len(failures) == 0), failures


# ---------------------------------------------------------------------------
# M3.6 -- Hash / immutability verification
# ---------------------------------------------------------------------------


def recompute_content_hash(evidence: dict[str, Any]) -> str:
    """Mirrors M2's _content_hash exactly: excludes createdAt (run metadata)
    and the hash field itself from the hashed payload."""
    stable = {k: v for k, v in evidence.items() if k not in ("createdAt", "_contentHash")}
    canonical = json.dumps(stable, sort_keys=True).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()[:16]


def verify_hash_integrity(evidence: dict[str, Any]) -> tuple[bool, list[str]]:
    stored_hash = evidence.get("_contentHash")
    if not stored_hash:
        return False, ["HASH_MISSING: no _contentHash present"]
    recomputed = recompute_content_hash(evidence)
    if recomputed != stored_hash:
        return False, [f"HASH_MISMATCH: stored={stored_hash} recomputed={recomputed} -- Evidence content has changed since generation"]
    return True, []


# ---------------------------------------------------------------------------
# Top-level orchestration (M3.8)
# ---------------------------------------------------------------------------


def verify_evidence_package(
    evidence_path: Path,
    source_artifact_path: Path | None = None,
    expected_version_id: str | None = None,
    registry_path: Path | None = None,
) -> EvidenceVerification:
    evidence, trades = load_evidence_package(evidence_path)
    registry = json.loads(registry_path.read_text(encoding="utf-8")) if registry_path and registry_path.exists() else {}
    registry = {k: v for k, v in registry.items() if not k.startswith("_")}

    all_failures: list[str] = []
    all_warnings: list[str] = []

    source_ok, source_failures = verify_source_artifact(evidence, source_artifact_path)
    all_failures += source_failures

    provenance_ok, provenance_failures, provenance_warnings = verify_identity_and_provenance(evidence, registry)
    all_failures += provenance_failures
    all_warnings += provenance_warnings

    trade_ok, trade_failures = verify_trade_consistency(evidence, trades)
    all_failures += trade_failures

    metric_ok, metric_failures, _comparison = verify_metric_reconciliation(evidence, trades)
    all_failures += metric_failures

    binding_ok, binding_failures = verify_version_binding(evidence, expected_version_id)
    all_failures += binding_failures

    hash_ok, hash_failures = verify_hash_integrity(evidence)
    all_failures += hash_failures

    status = "VERIFIED" if (
        source_ok is not False and provenance_ok and trade_ok and metric_ok and binding_ok and hash_ok
    ) else "FAILED"

    return EvidenceVerification(
        evidenceId=evidence.get("_contentHash", "UNKNOWN"),
        verifiedAt=datetime.utcnow().isoformat() + "Z",
        verifierVersion=VERIFIER_VERSION,
        sourceArtifactVerified=source_ok,
        provenanceVerified=provenance_ok,
        tradeIntegrityVerified=trade_ok,
        metricIntegrityVerified=metric_ok,
        versionBindingVerified=binding_ok,
        hashVerified=hash_ok,
        status=status,
        failures=all_failures,
        warnings=all_warnings,
    )


def main() -> None:
    p = argparse.ArgumentParser(description="M3 Evidence Integrity Verifier")
    p.add_argument("--evidence", required=True, type=Path, help="Path to an M2 Evidence package JSON")
    p.add_argument("--source-artifact", type=Path, help="Current path to the original source artifact (e.g. the .htm report)")
    p.add_argument("--expected-version-id", help="The versionId this Evidence is expected to belong to")
    p.add_argument("--registry", type=Path, default=Path(__file__).parent / "version_registry.json")
    p.add_argument("--out", type=Path, help="Optional path to write the verification result JSON")
    args = p.parse_args()

    result = verify_evidence_package(args.evidence, args.source_artifact, args.expected_version_id, args.registry)
    output = json.dumps(result.to_dict(), indent=2)
    print(output)
    if args.out:
        args.out.write_text(output, encoding="utf-8")


if __name__ == "__main__":
    main()
