"""
M7 -- Trust Status Engine (AT24 Marketplace program).

Derives an evidence-STATE (never a quality/profitability verdict) for one
TradingSystem Version from its M3 verification, M4 validation, M5 risk
analysis, and M6 history results. Append-only TrustStatus records. No
Score, no seller-authored status -- see M7_trust_status.md.

TRUST_RULESET_VERSION = "none-defined" -- no business thresholds frozen.
"""

from __future__ import annotations

import hashlib
import json
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent.parent / "m2-evidence-engine"))
sys.path.insert(0, str(Path(__file__).parent.parent / "m3-evidence-verification"))
sys.path.insert(0, str(Path(__file__).parent.parent / "m4-validation-engine"))
sys.path.insert(0, str(Path(__file__).parent.parent / "m5-risk-analysis"))
sys.path.insert(0, str(Path(__file__).parent.parent / "m6-history-engine"))
from evidence_verifier import load_evidence_package, verify_evidence_package  # noqa: E402
from risk_analysis_engine import validation_result_hash  # noqa: E402  (defined in M5, reused here)
from history_engine import verify_chain  # noqa: E402

ENGINE_VERSION = "AT24-M7-Trust-Status-Engine-v1.0"
METHODOLOGY_VERSION = "M7-methodology-v1"
TRUST_RULESET_VERSION = "none-defined"  # deliberate -- section 4, no business thresholds frozen

STATUS_VALUES = frozenset({
    "UNVERIFIED", "VALIDATION_PENDING", "VALIDATED", "INCONCLUSIVE",
    "LIMITED", "UNDER_OBSERVATION", "INVALIDATED", "SUPERSEDED",
})

MIN_OBSERVATIONS_FOR_VALIDATED = 1  # Sprint M12 branding follow-on (v2 policy): was 2 ("need >1 point to
# call it observed more than once"). Lowered deliberately, explicit business decision, not a bug fix -
# M4's own validation methodology (walk-forward train/test split, out-of-sample split, temporal-stability
# across the full evidence period, plus real regime-coverage and parameter-sensitivity checks) already
# tests whether a strategy holds up across different time periods and conditions WITHIN one evidence
# submission. A second, separate "AT24 looks at the identical evidence again later" pass is largely
# redundant with what M4 already verifies, and only adds delay. What does NOT change: Evidence must still
# be genuinely VERIFIED, Validation must still genuinely PASS/WARNING, RiskAnalysis must still genuinely
# be COMPLETE - this lowers how many times AT24 re-observes the same real result, never softens what the
# result itself has to be.


class InputIntegrityFailureError(Exception):
    pass


class VersionBindingFailureError(Exception):
    pass


class HistoryIntegrityFailureError(Exception):
    pass


# ---------------------------------------------------------------------------
# Explanation templates (section 12) -- structured facts only, no free-form generation
# ---------------------------------------------------------------------------

_EXPLANATION_TEMPLATES = {
    "EVIDENCE_NOT_VERIFIED": "Evidence integrity verification (M3) did not pass (status={m3_status}); no higher Trust Status is reachable regardless of downstream Validation/RiskAnalysis.",
    "VALIDATION_NOT_AVAILABLE": "Evidence integrity is verified (M3 VERIFIED), but no Validation (M4) result has been supplied yet.",
    "VALIDATION_INCONCLUSIVE": "Evidence integrity is verified, but the current Validation (M4) result is INCONCLUSIVE (overallStatus={m4_status}) -- {m4_detail}",
    "VALIDATION_FAILED": "Evidence integrity is verified, but the current Validation (M4) result is FAIL (overallStatus={m4_status}) -- one or more validation procedures did not complete successfully.",
    "RISK_ANALYSIS_MISSING": "Evidence and Validation are sufficient, but RiskAnalysis (M5) is {risk_state} -- a definitive Trust Status requires a computed risk profile.",
    "RISK_ANALYSIS_PARTIAL": "Evidence and Validation are sufficient, but RiskAnalysis (M5) is PARTIAL -- {risk_gaps}.",
    "HISTORY_INSUFFICIENT": "Evidence, Validation, and RiskAnalysis are all sufficient, but only {observation_count} historical observation(s) have been recorded (M6) -- AT24 has not yet observed this Version across more than one point in time.",
    "VALIDATION_COMPLETE": "Evidence integrity is verified, Validation (M4) supports it (overallStatus={m4_status}), RiskAnalysis (M5) is COMPLETE, and {observation_count} independent historical observations have been recorded.",
    "EVIDENCE_INVALIDATED": "A later, verified History event invalidated this Version's Evidence (event={event_id}, reason={reason}).",
    "VALIDATION_INVALIDATED": "A later, verified History event invalidated this Version's Validation result (event={event_id}, reason={reason}).",
    "RISK_ANALYSIS_INVALIDATED": "A later, verified History event invalidated this Version's RiskAnalysis result (event={event_id}, reason={reason}).",
    "VERSION_SUPERSEDED": "This Version was explicitly superseded by {new_version} (event={event_id}, reason={reason}).",
}


def generate_explanation(reason_code: str, facts: dict[str, Any]) -> str:
    template = _EXPLANATION_TEMPLATES.get(reason_code)
    if template is None:
        return f"({reason_code}: no explanation template defined)"
    try:
        return template.format(**facts)
    except KeyError as e:
        return f"({reason_code}: explanation template missing fact {e})"


# ---------------------------------------------------------------------------
# Hashing (append-only records, section 18-20)
# ---------------------------------------------------------------------------


def _content_hash(payload: dict[str, Any]) -> str:
    stable = {k: v for k, v in payload.items() if k not in ("id", "statusContentHash")}
    canonical = json.dumps(stable, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Integrity / binding / history gates (sections 8-10)
# ---------------------------------------------------------------------------


def _risk_result_hash(risk_result: dict[str, Any] | None) -> str | None:
    return risk_result.get("riskAnalysisHash") if risk_result else None


def verify_inputs(
    evidence: dict[str, Any],
    validation_result: dict[str, Any] | None,
    risk_result: dict[str, Any] | None,
    history_chain: list[dict[str, Any]] | None,
    expected_version_id: str,
    expected_evidence_hash: str | None = None,
    expected_validation_hash: str | None = None,
    expected_risk_hash: str | None = None,
) -> None:
    actual_evidence_hash = evidence.get("_contentHash")
    if expected_evidence_hash is not None and actual_evidence_hash != expected_evidence_hash:
        raise InputIntegrityFailureError(f"INPUT_INTEGRITY_FAILURE: Evidence hash {actual_evidence_hash} != expected {expected_evidence_hash}")

    if validation_result is not None:
        actual_validation_hash = validation_result_hash(validation_result)
        if expected_validation_hash is not None and actual_validation_hash != expected_validation_hash:
            raise InputIntegrityFailureError(f"INPUT_INTEGRITY_FAILURE: Validation hash {actual_validation_hash} != expected {expected_validation_hash}")
        if validation_result.get("versionId") != expected_version_id:
            raise VersionBindingFailureError(f"VERSION_BINDING_FAILURE: Validation result versionId={validation_result.get('versionId')!r} != {expected_version_id!r}")

    if risk_result is not None:
        actual_risk_hash = _risk_result_hash(risk_result)
        if expected_risk_hash is not None and actual_risk_hash != expected_risk_hash:
            raise InputIntegrityFailureError(f"INPUT_INTEGRITY_FAILURE: RiskAnalysis hash {actual_risk_hash} != expected {expected_risk_hash}")
        if risk_result.get("versionId") != expected_version_id:
            raise VersionBindingFailureError(f"VERSION_BINDING_FAILURE: RiskAnalysis versionId={risk_result.get('versionId')!r} != {expected_version_id!r}")

    if evidence.get("versionId") != expected_version_id:
        raise VersionBindingFailureError(f"VERSION_BINDING_FAILURE: Evidence versionId={evidence.get('versionId')!r} != {expected_version_id!r}")

    if history_chain:
        ok, issues = verify_chain(history_chain)
        if not ok:
            raise HistoryIntegrityFailureError("HISTORY_CHAIN_FAILURE: " + "; ".join(issues))


# ---------------------------------------------------------------------------
# History-derived facts
# ---------------------------------------------------------------------------


def _find_invalidation(history_chain: list[dict[str, Any]] | None, artifact_id: str | None) -> dict[str, Any] | None:
    if not history_chain or not artifact_id:
        return None
    invalidation_types = {"EVIDENCE_INVALIDATED", "VALIDATION_INVALIDATED", "RISK_ANALYSIS_INVALIDATED"}
    for ev in history_chain:
        if ev["eventType"] in invalidation_types and ev.get("payload", {}).get("invalidates") in (artifact_id,):
            return ev
        # also match if the invalidated event's own referenced artifact id equals ours
        if ev["eventType"] in invalidation_types and ev.get("evidenceId") == artifact_id:
            return ev
    return None


def _find_supersession(history_chain: list[dict[str, Any]] | None, version_id: str) -> dict[str, Any] | None:
    if not history_chain:
        return None
    for ev in history_chain:
        if ev["eventType"] == "VERSION_SUPERSEDED" and ev.get("payload", {}).get("supersededVersion") == version_id:
            return ev
    return None


def count_observations(history_chain: list[dict[str, Any]] | None) -> int:
    if not history_chain:
        return 0
    return sum(1 for ev in history_chain if ev["eventType"] == "RISK_ANALYSIS_COMPLETED")


# ---------------------------------------------------------------------------
# Status derivation (sections 3, 6, 11, 14 -- the precedence-ordered state machine)
# ---------------------------------------------------------------------------


def derive_trust_status(
    evidence: dict[str, Any],
    m3_status: str,
    validation_result: dict[str, Any] | None,
    risk_result: dict[str, Any] | None,
    history_chain: list[dict[str, Any]] | None,
    version_id: str,
) -> tuple[str, str, str]:
    """Returns (status, reasonCode, explanation). Precedence order per
    M7_trust_status.md section 2 -- checked in this exact order, every time."""
    evidence_id = evidence.get("_contentHash")

    supersession = _find_supersession(history_chain, version_id)
    if supersession:
        facts = {"new_version": supersession["payload"].get("newVersion", "?"), "event_id": supersession["historyEventId"],
                  "reason": supersession["payload"].get("reason", "not specified")}
        return "SUPERSEDED", "VERSION_SUPERSEDED", generate_explanation("VERSION_SUPERSEDED", facts)

    invalidation = _find_invalidation(history_chain, evidence_id)
    if invalidation:
        reason_code = invalidation["eventType"]  # EVIDENCE_INVALIDATED | VALIDATION_INVALIDATED | RISK_ANALYSIS_INVALIDATED
        facts = {"event_id": invalidation["historyEventId"], "reason": invalidation["payload"].get("reason", "not specified")}
        return "INVALIDATED", reason_code, generate_explanation(reason_code, facts)

    if m3_status != "VERIFIED":
        return "UNVERIFIED", "EVIDENCE_NOT_VERIFIED", generate_explanation("EVIDENCE_NOT_VERIFIED", {"m3_status": m3_status})

    if validation_result is None:
        return "VALIDATION_PENDING", "VALIDATION_NOT_AVAILABLE", generate_explanation("VALIDATION_NOT_AVAILABLE", {})

    m4_status = validation_result.get("overallStatus")
    if m4_status == "FAIL":
        return "INCONCLUSIVE", "VALIDATION_FAILED", generate_explanation("VALIDATION_FAILED", {"m4_status": m4_status})
    if m4_status == "INCONCLUSIVE":
        inconclusive_types = [r["validationType"] for r in validation_result.get("records", []) if r["status"] == "INCONCLUSIVE"]
        detail = f"validation types not conclusively completed: {', '.join(inconclusive_types)}" if inconclusive_types else "one or more validation types did not complete"
        return "INCONCLUSIVE", "VALIDATION_INCONCLUSIVE", generate_explanation("VALIDATION_INCONCLUSIVE", {"m4_status": m4_status, "m4_detail": detail})

    # m4_status in ("PASS", "WARNING") from here on
    if risk_result is None:
        return "INCONCLUSIVE", "RISK_ANALYSIS_MISSING", generate_explanation("RISK_ANALYSIS_MISSING", {"risk_state": "not available"})

    risk_status = risk_result.get("status")
    if risk_status in ("INCONCLUSIVE", "FAILED"):
        return "INCONCLUSIVE", "RISK_ANALYSIS_MISSING", generate_explanation("RISK_ANALYSIS_MISSING", {"risk_state": risk_status})

    if risk_status == "PARTIAL":
        gaps = [k for k, v in risk_result.get("dataQuality", {}).items() if v not in ("AVAILABLE",)]
        facts = {"risk_gaps": f"incomplete dimensions: {', '.join(gaps)}" if gaps else "one or more risk dimensions incomplete"}
        return "LIMITED", "RISK_ANALYSIS_PARTIAL", generate_explanation("RISK_ANALYSIS_PARTIAL", facts)

    # risk_status == "COMPLETE" from here on -- everything is sufficient except possibly observation depth
    observation_count = count_observations(history_chain)
    if observation_count < MIN_OBSERVATIONS_FOR_VALIDATED:
        return "UNDER_OBSERVATION", "HISTORY_INSUFFICIENT", generate_explanation("HISTORY_INSUFFICIENT", {"observation_count": observation_count})

    return "VALIDATED", "VALIDATION_COMPLETE", generate_explanation("VALIDATION_COMPLETE", {"m4_status": m4_status, "observation_count": observation_count})


# ---------------------------------------------------------------------------
# TrustStatus record + append-only chain (sections 18-20)
# ---------------------------------------------------------------------------


def build_trust_status_record(
    tradingSystemId: str, versionId: str, status: str, reasonCode: str, explanation: str,
    evidence: dict[str, Any], validation_result: dict[str, Any] | None, risk_result: dict[str, Any] | None,
    history_chain: list[dict[str, Any]] | None, generatedAt: str, effectiveAt: str,
    previous_status: dict[str, Any] | None,
) -> dict[str, Any]:
    assert status in STATUS_VALUES, f"Unknown status {status!r}"
    record = {
        "tradingSystemId": tradingSystemId, "versionId": versionId, "status": status,
        "reasonCode": reasonCode, "explanation": explanation,
        "evidenceId": evidence.get("_contentHash"), "evidenceHash": evidence.get("_contentHash"),
        "validationId": validation_result.get("evidenceId") if validation_result else None,
        "validationHash": validation_result_hash(validation_result) if validation_result else None,
        "riskAnalysisId": risk_result.get("riskAnalysisId") if risk_result else None,
        "riskAnalysisHash": _risk_result_hash(risk_result),
        "historyReference": history_chain[-1].get("historyEventId") if history_chain else None,
        "rulesetVersion": TRUST_RULESET_VERSION, "methodologyVersion": METHODOLOGY_VERSION,
        "generatedAt": generatedAt, "effectiveAt": effectiveAt,
        "previousStatusId": previous_status["id"] if previous_status else None,
        "provenance": {"engineVersion": ENGINE_VERSION},
    }
    content_hash = _content_hash(record)
    record["id"] = content_hash
    record["statusContentHash"] = content_hash
    return record


def append_trust_status(chain: list[dict[str, Any]], **kwargs) -> list[dict[str, Any]]:
    previous_status = chain[-1] if chain else None
    new_record = build_trust_status_record(previous_status=previous_status, **kwargs)
    return chain + [new_record]


# ---------------------------------------------------------------------------
# Top-level orchestration
# ---------------------------------------------------------------------------


def run_trust_status(
    evidence_path: Path,
    source_artifact_path: Path | None,
    expected_version_id: str,
    registry_path: Path,
    tradingSystemId: str,
    validation_result: dict[str, Any] | None,
    risk_result: dict[str, Any] | None,
    history_chain: list[dict[str, Any]] | None,
    trust_status_chain: list[dict[str, Any]],
    generatedAt: str | None = None,
    effectiveAt: str | None = None,
    expected_evidence_hash: str | None = None,
    expected_validation_hash: str | None = None,
    expected_risk_hash: str | None = None,
) -> list[dict[str, Any]]:
    m3_result = verify_evidence_package(evidence_path, source_artifact_path, expected_version_id, registry_path)
    evidence, _trades = load_evidence_package(evidence_path)

    verify_inputs(evidence, validation_result, risk_result, history_chain, expected_version_id,
                  expected_evidence_hash, expected_validation_hash, expected_risk_hash)

    status, reason_code, explanation = derive_trust_status(
        evidence, m3_result.status, validation_result, risk_result, history_chain, expected_version_id,
    )

    now = generatedAt or (datetime.utcnow().isoformat() + "Z")
    eff = effectiveAt or now
    return append_trust_status(
        trust_status_chain, tradingSystemId=tradingSystemId, versionId=expected_version_id,
        status=status, reasonCode=reason_code, explanation=explanation,
        evidence=evidence, validation_result=validation_result, risk_result=risk_result,
        history_chain=history_chain, generatedAt=now, effectiveAt=eff,
    )
