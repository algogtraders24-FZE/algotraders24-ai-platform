"""
M6 -- History & Longitudinal Evidence Engine (AT24 Marketplace program).

Append-only, hash-chained observation log over M2/M3/M4/M5 artifacts. Never
a Score, Trust Status, or ranking -- see M6_history_longitudinal_evidence.md.

Platform-agnostic: operates only on tradingSystemId/versionId strings and
the content hashes/provenance any adapter's Evidence/Validation/RiskAnalysis
already carries.
"""

from __future__ import annotations

import hashlib
import json
import statistics
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

ENGINE_VERSION = "AT24-M6-History-Engine-v1.0"
METHODOLOGY_VERSION = "M6-methodology-v1"
ACCEPTANCE_RULESET_VERSION = "none-defined"  # deliberate -- no quality/trust judgment anywhere in this engine

EVENT_TYPES = frozenset({
    "SYSTEM_CREATED", "VERSION_CREATED", "EVIDENCE_ADDED", "EVIDENCE_VERIFIED",
    "VALIDATION_COMPLETED", "RISK_ANALYSIS_COMPLETED", "EVIDENCE_INVALIDATED",
    "VALIDATION_INVALIDATED", "RISK_ANALYSIS_INVALIDATED", "VERSION_SUPERSEDED",
    "VERSION_WITHDRAWN", "OBSERVATION_RECORDED", "CORRECTION_RECORDED",
})


class ImmutabilityFailureError(Exception):
    pass


class HistoryChainFailureError(Exception):
    pass


class VersionBindingFailureError(Exception):
    pass


# ---------------------------------------------------------------------------
# Hashing (section 9) -- observedAt/recordedAt ARE included, unlike M2-M5's
# createdAt exclusion. See design doc section 7 for why.
# ---------------------------------------------------------------------------


def _canonical_hash(payload: dict[str, Any]) -> str:
    canonical = json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()[:16]


def _event_content_hash(event: dict[str, Any]) -> str:
    """Everything except the two hash-identity fields themselves."""
    stable = {k: v for k, v in event.items() if k not in ("historyEventId", "contentHash")}
    return _canonical_hash(stable)


# ---------------------------------------------------------------------------
# Event construction (sections 2, 5, 6, 8)
# ---------------------------------------------------------------------------


def create_event(
    tradingSystemId: str,
    versionId: str,
    eventType: str,
    observedAt: str,
    recordedAt: str,
    source: str,
    sourceHash: str | None,
    payload: dict[str, Any],
    previous_event: dict[str, Any] | None,
    evidenceId: str | None = None,
    validationId: str | None = None,
    riskAnalysisId: str | None = None,
    rulesetVersion: str = ACCEPTANCE_RULESET_VERSION,
    methodologyVersion: str = METHODOLOGY_VERSION,
) -> dict[str, Any]:
    if eventType not in EVENT_TYPES:
        raise ValueError(f"Unknown eventType '{eventType}' -- not in the controlled vocabulary {sorted(EVENT_TYPES)}")

    prev_id = previous_event["historyEventId"] if previous_event else None
    prev_hash = previous_event["contentHash"] if previous_event else None

    event = {
        "tradingSystemId": tradingSystemId, "versionId": versionId, "evidenceId": evidenceId,
        "validationId": validationId, "riskAnalysisId": riskAnalysisId, "eventType": eventType,
        "observedAt": observedAt, "recordedAt": recordedAt, "source": source, "sourceHash": sourceHash,
        "payload": payload, "previousEventId": prev_id, "previousEventHash": prev_hash,
        "rulesetVersion": rulesetVersion, "methodologyVersion": methodologyVersion, "createdBy": ENGINE_VERSION,
    }
    content_hash = _event_content_hash(event)
    event["historyEventId"] = content_hash
    event["contentHash"] = content_hash
    return event


def append_event(chain: list[dict[str, Any]], **kwargs) -> list[dict[str, Any]]:
    """Pure function: returns a NEW list with the new event appended. Never
    mutates `chain` or any existing event in it -- section 4's append-only
    discipline enforced at the Python level, not just documented."""
    previous_event = chain[-1] if chain else None
    new_event = create_event(previous_event=previous_event, **kwargs)
    return chain + [new_event]


def check_event_immutability(original_event: dict[str, Any], attempted_new_version: dict[str, Any]) -> None:
    """Raises ImmutabilityFailureError if someone tries to pass off a
    content-changed event under the same historyEventId -- i.e. an edit
    disguised as the same event, rather than a new CORRECTION_RECORDED."""
    if original_event["historyEventId"] != attempted_new_version.get("historyEventId"):
        return  # different id -- not claiming to be the same event, nothing to check here
    recomputed_original = _event_content_hash(original_event)
    recomputed_attempt = _event_content_hash(attempted_new_version)
    if recomputed_original != recomputed_attempt:
        raise ImmutabilityFailureError(
            f"IMMUTABILITY_FAILURE: an event claiming historyEventId={original_event['historyEventId']} "
            f"has different content than the original (original hash {recomputed_original} != attempted {recomputed_attempt}). "
            f"History events are append-only -- record a CORRECTION_RECORDED event instead of editing."
        )


# ---------------------------------------------------------------------------
# Chain integrity (section 10, Tests E/F/G)
# ---------------------------------------------------------------------------


def verify_chain(events: list[dict[str, Any]]) -> tuple[bool, list[str]]:
    issues: list[str] = []
    for i, ev in enumerate(events):
        recomputed = _event_content_hash(ev)
        if recomputed != ev.get("contentHash"):
            issues.append(f"HISTORY_CHAIN_FAILURE: event at index {i} (id={ev.get('historyEventId')}) content hash does not match its own stored hash -- tampered.")

        if i == 0:
            if ev.get("previousEventId") is not None:
                issues.append(f"HISTORY_CHAIN_FAILURE: first event in chain has a non-null previousEventId ({ev.get('previousEventId')}) -- not a genesis event.")
        else:
            prev = events[i - 1]
            if ev.get("previousEventId") != prev.get("historyEventId") or ev.get("previousEventHash") != prev.get("contentHash"):
                issues.append(
                    f"HISTORY_CHAIN_FAILURE: event at index {i} (id={ev.get('historyEventId')}) does not correctly reference the "
                    f"preceding event (expected previousEventId={prev.get('historyEventId')}, got {ev.get('previousEventId')}) -- "
                    f"possible deleted, inserted, or reordered event."
                )
    return (len(issues) == 0), issues


# ---------------------------------------------------------------------------
# Version binding (section 13, Test I)
# ---------------------------------------------------------------------------


def check_version_binding(artifact: dict[str, Any], expected_version_id: str, artifact_kind: str) -> None:
    actual = artifact.get("versionId")
    if actual != expected_version_id:
        raise VersionBindingFailureError(
            f"VERSION_BINDING_FAILURE: {artifact_kind} declares versionId={actual!r}, but is being recorded under versionId={expected_version_id!r}."
        )


# ---------------------------------------------------------------------------
# Evidence age (section 17, Test N)
# ---------------------------------------------------------------------------


def _parse_iso(value: str) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", ""))
    except ValueError:
        return None


def compute_evidence_age(reference_time: datetime, evidence: dict[str, Any]) -> dict[str, Any]:
    period_end = evidence.get("provenance", {}).get("periodEnd")
    observed_at = _parse_iso(period_end) if period_end else None
    if observed_at is None:
        return {"ageDays": None, "referenceTime": reference_time.isoformat(), "observedAt": None,
                "note": "Evidence has no provenance.periodEnd -- age not computable."}
    age_days = (reference_time - observed_at).days
    return {"ageDays": age_days, "referenceTime": reference_time.isoformat(), "observedAt": observed_at.isoformat(),
            "note": f"Evidence age = {age_days} days (no expiration threshold applied -- interpretation belongs to a later layer)."}


# ---------------------------------------------------------------------------
# History gaps + cadence (sections 18/19, Test M)
# ---------------------------------------------------------------------------


def detect_history_gaps(observation_events: list[dict[str, Any]]) -> dict[str, Any]:
    timestamps = sorted(_parse_iso(e["recordedAt"]) for e in observation_events if _parse_iso(e.get("recordedAt")))
    if len(timestamps) < 2:
        return {"gaps": [], "longestGapDays": None, "note": "Fewer than 2 observations -- no gap is computable."}

    gaps = [{"from": timestamps[i].isoformat(), "to": timestamps[i + 1].isoformat(), "gapDays": (timestamps[i + 1] - timestamps[i]).days}
            for i in range(len(timestamps) - 1)]
    longest = max(gaps, key=lambda g: g["gapDays"])
    return {"gaps": gaps, "longestGapDays": longest["gapDays"], "longestGap": longest,
            "note": "HISTORY_GAP facts reported; no automatic trust/staleness classification applied."}


def analyze_cadence(observation_events: list[dict[str, Any]]) -> dict[str, Any]:
    timestamps = sorted(_parse_iso(e["recordedAt"]) for e in observation_events if _parse_iso(e.get("recordedAt")))
    if len(timestamps) < 2:
        return {"observationCount": len(timestamps), "averageIntervalDays": None, "medianIntervalDays": None,
                "longestGapDays": None, "mostRecentGapDays": None,
                "note": "Fewer than 2 observations -- cadence not computable. No marketplace-frequency threshold applied."}

    intervals = [(timestamps[i + 1] - timestamps[i]).days for i in range(len(timestamps) - 1)]
    return {
        "observationCount": len(timestamps),
        "averageIntervalDays": round(statistics.mean(intervals), 1),
        "medianIntervalDays": round(statistics.median(intervals), 1),
        "longestGapDays": max(intervals),
        "mostRecentGapDays": intervals[-1],
        "note": "No marketplace-frequency threshold applied -- facts only, per design doc section 19.",
    }


# ---------------------------------------------------------------------------
# Comparability + change detection (sections 20-23, Tests O/P/Q)
# ---------------------------------------------------------------------------


COMPARABILITY_FIELDS = [
    ("symbol", lambda e: e.get("provenance", {}).get("symbol")),
    ("timeframe", lambda e: e.get("provenance", {}).get("timeframe")),
    ("sourceAdapter", lambda e: e.get("sourceAdapter")),
    ("evidenceClass", lambda e: e.get("evidenceClass")),
]


def _metric_delta(prev: float | None, new: float | None) -> dict[str, Any]:
    if prev is None or new is None:
        return {"previous": prev, "new": new, "delta": None, "percentChange": None}
    delta = round(new - prev, 6)
    pct = round((delta / abs(prev)) * 100, 2) if prev != 0 else None
    return {"previous": prev, "new": new, "delta": delta, "percentChange": pct}


def detect_change(evidence_a: dict[str, Any], risk_a: dict[str, Any] | None,
                   evidence_b: dict[str, Any], risk_b: dict[str, Any] | None) -> dict[str, Any]:
    version_a, version_b = evidence_a.get("versionId"), evidence_b.get("versionId")
    if version_a != version_b:
        return {
            "changeType": "VERSION_CHANGE", "oldVersion": version_a, "newVersion": version_b,
            "note": "A change across Version boundaries is a version transition, not ordinary same-version metric drift -- see design doc section 21. Not classified as PERFORMANCE_DETERIORATION or any other same-version label.",
        }

    mismatches = []
    for label, getter in COMPARABILITY_FIELDS:
        va, vb = getter(evidence_a), getter(evidence_b)
        if va != vb:
            mismatches.append(f"{label}: {va!r} != {vb!r}")
    if mismatches:
        return {"changeType": "NOT_DIRECTLY_COMPARABLE", "versionId": version_a, "reasons": mismatches,
                "note": "Observations share a Version but differ on required comparability conditions -- not force-normalized (design doc section 23)."}

    pf_a = evidence_a.get("metricsSummary", {}).get("profitFactor")
    pf_b = evidence_b.get("metricsSummary", {}).get("profitFactor")
    dd_a = (risk_a or {}).get("drawdown", {}).get("maxDrawdownPercent")
    dd_b = (risk_b or {}).get("drawdown", {}).get("maxDrawdownPercent")
    exp_a = (risk_a or {}).get("expectancy", {}).get("expectancyPerTrade")
    exp_b = (risk_b or {}).get("expectancy", {}).get("expectancyPerTrade")

    return {
        "changeType": "METRIC_CHANGE", "versionId": version_a,
        "metrics": {"profitFactor": _metric_delta(pf_a, pf_b), "maxDrawdownPercent": _metric_delta(dd_a, dd_b), "expectancyPerTrade": _metric_delta(exp_a, exp_b)},
        "observationTimestamps": {"a": evidence_a.get("provenance", {}).get("periodEnd"), "b": evidence_b.get("provenance", {}).get("periodEnd")},
        "note": "Reported as a fact only -- no automatic good/bad classification (design doc section 20).",
    }


# ---------------------------------------------------------------------------
# Convenience builders for the real (and synthetic) G01-style chain
# ---------------------------------------------------------------------------


def build_system_lifecycle_chain(
    tradingSystemId: str, versionId: str,
    evidence: dict[str, Any], m3_result, validation_result: dict[str, Any], risk_result: dict[str, Any],
    recorded_at: str,
) -> list[dict[str, Any]]:
    """Builds the canonical SYSTEM_CREATED -> VERSION_CREATED -> EVIDENCE_ADDED
    -> EVIDENCE_VERIFIED -> VALIDATION_COMPLETED -> RISK_ANALYSIS_COMPLETED
    chain for one observation, with version-binding checks enforced on every
    artifact before it's recorded."""
    check_version_binding(evidence, versionId, "Evidence")
    check_version_binding(validation_result, versionId, "Validation result")
    check_version_binding(risk_result, versionId, "RiskAnalysis")

    period_end = evidence.get("provenance", {}).get("periodEnd") or recorded_at
    chain: list[dict[str, Any]] = []
    chain = append_event(chain, tradingSystemId=tradingSystemId, versionId=versionId, eventType="SYSTEM_CREATED",
                          observedAt=recorded_at, recordedAt=recorded_at, source=ENGINE_VERSION, sourceHash=None,
                          payload={"tradingSystemId": tradingSystemId})
    chain = append_event(chain, tradingSystemId=tradingSystemId, versionId=versionId, eventType="VERSION_CREATED",
                          observedAt=recorded_at, recordedAt=recorded_at, source=ENGINE_VERSION, sourceHash=None,
                          payload={"versionId": versionId})
    chain = append_event(chain, tradingSystemId=tradingSystemId, versionId=versionId, eventType="EVIDENCE_ADDED",
                          observedAt=period_end, recordedAt=recorded_at, source=evidence.get("generatedBy"),
                          sourceHash=evidence.get("_contentHash"), evidenceId=evidence.get("_contentHash"),
                          payload={"sourceAdapter": evidence.get("sourceAdapter"), "tradeCount": evidence.get("metricsSummary", {}).get("tradeCount")})
    chain = append_event(chain, tradingSystemId=tradingSystemId, versionId=versionId, eventType="EVIDENCE_VERIFIED",
                          observedAt=recorded_at, recordedAt=recorded_at, source="AT24-M3-Evidence-Verifier-v1.0",
                          sourceHash=m3_result.evidenceId, evidenceId=evidence.get("_contentHash"),
                          payload={"m3Status": m3_result.status, "warnings": m3_result.warnings})
    chain = append_event(chain, tradingSystemId=tradingSystemId, versionId=versionId, eventType="VALIDATION_COMPLETED",
                          observedAt=recorded_at, recordedAt=recorded_at, source=validation_result.get("engineVersion"),
                          sourceHash=validation_result.get("evidenceId"), evidenceId=evidence.get("_contentHash"),
                          validationId=validation_result.get("evidenceId"),
                          payload={"overallStatus": validation_result.get("overallStatus"),
                                   "recordStatuses": {r["validationType"]: r["status"] for r in validation_result.get("records", [])}})
    chain = append_event(chain, tradingSystemId=tradingSystemId, versionId=versionId, eventType="RISK_ANALYSIS_COMPLETED",
                          observedAt=recorded_at, recordedAt=recorded_at, source=risk_result.get("createdBy"),
                          sourceHash=risk_result.get("riskAnalysisHash"), evidenceId=evidence.get("_contentHash"),
                          validationId=validation_result.get("evidenceId"), riskAnalysisId=risk_result.get("riskAnalysisId"),
                          payload={"status": risk_result.get("status"), "dataQuality": risk_result.get("dataQuality")})
    return chain
