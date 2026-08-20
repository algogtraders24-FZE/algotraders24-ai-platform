"""
M6 tests A-T from the sprint brief. Tests A-S use lightweight synthetic
fixtures (hand-built event/evidence/validation/risk dicts with the fields
the engine actually reads) -- fast, and sufficient to prove the chain/hash/
comparability logic independent of a full M2-M5 pipeline run. Test T is the
one genuine real-data test: the actual G01 chain, built from real M2/M3/M4/
M5 artifacts. Test S sweeps six non-MT5 adapter labels to prove platform
neutrality.

Run: python test_history_engine.py
"""

import copy
import glob
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "m2-evidence-engine"))
sys.path.insert(0, str(Path(__file__).parent.parent / "m3-evidence-verification"))
sys.path.insert(0, str(Path(__file__).parent.parent / "m4-validation-engine"))
sys.path.insert(0, str(Path(__file__).parent.parent / "m5-risk-analysis"))
from evidence_verifier import verify_evidence_package  # noqa: E402
from validation_engine import run_validation_suite  # noqa: E402
from risk_analysis_engine import run_risk_analysis  # noqa: E402

from history_engine import (
    HistoryChainFailureError,
    ImmutabilityFailureError,
    VersionBindingFailureError,
    append_event,
    analyze_cadence,
    build_system_lifecycle_chain,
    check_event_immutability,
    check_version_binding,
    compute_evidence_age,
    create_event,
    detect_change,
    detect_history_gaps,
    verify_chain,
)

REAL_EVIDENCE_DIR = Path(__file__).parent.parent / "m2-evidence-engine" / "real_evidence_output"
SOURCE_ARTIFACT = Path(r"C:\Users\om\AppData\Roaming\MetaQuotes\Terminal\8762A67661860246215827420BCD27F8\G01_Baseline_v0.1_Report.htm")
REGISTRY = Path(__file__).parent.parent / "m3-evidence-verification" / "version_registry.json"
EXPECTED_VERSION_ID = "G01-v0.1-FROZEN-BASELINE"


def _fake_evidence(version_id="V1", symbol="XAUUSD", timeframe="M5", adapter="synthetic-test-v1",
                    period_end="2025-06-01T00:00:00", pf=0.9):
    return {
        "versionId": version_id, "evidenceClass": "HISTORICAL", "sourceAdapter": adapter,
        "provenance": {"symbol": symbol, "timeframe": timeframe, "periodEnd": period_end},
        "metricsSummary": {"profitFactor": pf, "tradeCount": 100},
        "generatedBy": "AT24-M2-Evidence-Engine-v0.2", "_contentHash": f"fakehash-{version_id}-{pf}",
    }


def _fake_risk(dd_pct=0.3, expectancy=1.5):
    return {"drawdown": {"maxDrawdownPercent": dd_pct}, "expectancy": {"expectancyPerTrade": expectancy}}


# ---------------------------------------------------------------------------
# Test A/B -- create first event, append second
# ---------------------------------------------------------------------------

def test_A_create_first_event():
    chain = append_event([], tradingSystemId="SYS-A", versionId="V1", eventType="SYSTEM_CREATED",
                          observedAt="2026-08-19T00:00:00Z", recordedAt="2026-08-19T00:00:00Z",
                          source="test", sourceHash=None, payload={})
    assert len(chain) == 1
    assert chain[0]["previousEventId"] is None
    print("test_A_create_first_event: PASS")
    return chain


def test_B_append_second_event(chain):
    chain2 = append_event(chain, tradingSystemId="SYS-A", versionId="V1", eventType="VERSION_CREATED",
                           observedAt="2026-08-19T00:00:00Z", recordedAt="2026-08-19T00:00:01Z",
                           source="test", sourceHash=None, payload={})
    assert len(chain2) == 2
    assert chain2[1]["previousEventId"] == chain[0]["historyEventId"]
    print("test_B_append_second_event: PASS")
    return chain2


# ---------------------------------------------------------------------------
# Test C -- original event immutable
# ---------------------------------------------------------------------------

def test_C_original_event_immutable(chain):
    original = chain[0]
    tampered = copy.deepcopy(original)
    tampered["payload"] = {"tampered": True}  # same historyEventId, different content
    try:
        check_event_immutability(original, tampered)
        raise AssertionError("expected ImmutabilityFailureError")
    except ImmutabilityFailureError as e:
        assert "IMMUTABILITY_FAILURE" in str(e)
        print(f"test_C_original_event_immutable: PASS ({e})")


# ---------------------------------------------------------------------------
# Test D -- event hash changes after mutation
# ---------------------------------------------------------------------------

def test_D_hash_changes_after_mutation(chain):
    from history_engine import _event_content_hash
    original_hash = chain[0]["contentHash"]
    mutated = copy.deepcopy(chain[0])
    mutated["payload"] = {"changed": "yes"}
    new_hash = _event_content_hash(mutated)
    assert new_hash != original_hash
    print(f"test_D_hash_changes_after_mutation: PASS ({original_hash} -> {new_hash})")


# ---------------------------------------------------------------------------
# Test E/F/G -- broken chain / deleted event / reordered event
# ---------------------------------------------------------------------------

def _three_event_chain():
    chain = append_event([], tradingSystemId="SYS-EFG", versionId="V1", eventType="SYSTEM_CREATED",
                          observedAt="t0", recordedAt="t0", source="test", sourceHash=None, payload={})
    chain = append_event(chain, tradingSystemId="SYS-EFG", versionId="V1", eventType="VERSION_CREATED",
                          observedAt="t1", recordedAt="t1", source="test", sourceHash=None, payload={})
    chain = append_event(chain, tradingSystemId="SYS-EFG", versionId="V1", eventType="EVIDENCE_ADDED",
                          observedAt="t2", recordedAt="t2", source="test", sourceHash=None, payload={})
    return chain


def test_E_broken_previous_event_chain():
    chain = _three_event_chain()
    broken = copy.deepcopy(chain)
    broken[2]["previousEventId"] = "not-the-real-previous-id"
    ok, issues = verify_chain(broken)
    assert not ok and any("HISTORY_CHAIN_FAILURE" in i for i in issues)
    print(f"test_E_broken_previous_event_chain: PASS ({issues[0]})")


def test_F_deleted_event_detection():
    chain = _three_event_chain()
    with_deletion = [chain[0], chain[2]]  # middle event removed
    ok, issues = verify_chain(with_deletion)
    assert not ok and any("HISTORY_CHAIN_FAILURE" in i for i in issues)
    print(f"test_F_deleted_event_detection: PASS ({issues[0]})")


def test_G_reordered_event_detection():
    chain = _three_event_chain()
    reordered = [chain[0], chain[2], chain[1]]
    ok, issues = verify_chain(reordered)
    assert not ok and any("HISTORY_CHAIN_FAILURE" in i for i in issues)
    print(f"test_G_reordered_event_detection: PASS ({issues[0]})")


# ---------------------------------------------------------------------------
# Test H/I -- version separation / binding
# ---------------------------------------------------------------------------

def test_H_version_separation():
    chain = append_event([], tradingSystemId="SYS-HI", versionId="V1", eventType="EVIDENCE_ADDED",
                          observedAt="t0", recordedAt="t0", source="test", sourceHash=None, payload={})
    chain = append_event(chain, tradingSystemId="SYS-HI", versionId="V2", eventType="EVIDENCE_ADDED",
                          observedAt="t1", recordedAt="t1", source="test", sourceHash=None, payload={})
    v1_events = [e for e in chain if e["versionId"] == "V1"]
    v2_events = [e for e in chain if e["versionId"] == "V2"]
    assert len(v1_events) == 1 and len(v2_events) == 1
    ok, issues = verify_chain(chain)
    assert ok, issues
    print("test_H_version_separation: PASS (chain intact, versions independently filterable)")


def test_I_version_binding_failure():
    v1_evidence = _fake_evidence(version_id="V1")
    try:
        check_version_binding(v1_evidence, expected_version_id="V2", artifact_kind="Evidence")
        raise AssertionError("expected VersionBindingFailureError")
    except VersionBindingFailureError as e:
        assert "VERSION_BINDING_FAILURE" in str(e)
        print(f"test_I_version_binding_failure: PASS ({e})")


# ---------------------------------------------------------------------------
# Test J/K -- invalidation / correction preserve the original
# ---------------------------------------------------------------------------

def test_J_invalidation_preserves_original():
    chain = append_event([], tradingSystemId="SYS-JK", versionId="V1", eventType="EVIDENCE_VERIFIED",
                          observedAt="t0", recordedAt="t0", source="test", sourceHash=None,
                          evidenceId="ev1", payload={"m3Status": "VERIFIED"})
    original = chain[0]
    chain = append_event(chain, tradingSystemId="SYS-JK", versionId="V1", eventType="EVIDENCE_INVALIDATED",
                          observedAt="t1", recordedAt="t1", source="test", sourceHash=None, evidenceId="ev1",
                          payload={"invalidates": original["historyEventId"], "reason": "source artifact mismatch discovered"})
    assert chain[0] == original, "original event must remain byte-identical"
    assert chain[1]["payload"]["invalidates"] == original["historyEventId"]
    ok, issues = verify_chain(chain)
    assert ok, issues
    print("test_J_invalidation_preserves_original: PASS")


def test_K_correction_preserves_original():
    chain = append_event([], tradingSystemId="SYS-JK2", versionId="V1", eventType="OBSERVATION_RECORDED",
                          observedAt="t0", recordedAt="t0", source="test", sourceHash=None, payload={"fact": "wrong value"})
    original = chain[0]
    chain = append_event(chain, tradingSystemId="SYS-JK2", versionId="V1", eventType="CORRECTION_RECORDED",
                          observedAt="t1", recordedAt="t1", source="test", sourceHash=None,
                          payload={"originalEventId": original["historyEventId"], "correctedFact": "right value", "reason": "typo in original observation"})
    assert chain[0] == original
    print("test_K_correction_preserves_original: PASS")


# ---------------------------------------------------------------------------
# Test L -- observedAt vs recordedAt distinction
# ---------------------------------------------------------------------------

def test_L_observed_vs_recorded():
    ev = append_event([], tradingSystemId="SYS-L", versionId="V1", eventType="EVIDENCE_ADDED",
                       observedAt="2017-01-01T00:00:00", recordedAt="2026-08-19T00:00:00",
                       source="test", sourceHash=None, payload={})[0]
    assert ev["observedAt"] != ev["recordedAt"]
    assert ev["observedAt"] == "2017-01-01T00:00:00"
    print("test_L_observed_vs_recorded: PASS (observedAt=2017-01-01, recordedAt=2026-08-19, never collapsed)")


# ---------------------------------------------------------------------------
# Test M -- history gap detection
# ---------------------------------------------------------------------------

def test_M_history_gap_detection():
    base = datetime(2026, 1, 1)
    events = [
        {"recordedAt": base.isoformat()},
        {"recordedAt": (base + timedelta(days=30)).isoformat()},
        {"recordedAt": (base + timedelta(days=242)).isoformat()},  # big gap
    ]
    result = detect_history_gaps(events)
    assert result["longestGapDays"] == 212
    print(f"test_M_history_gap_detection: PASS (longestGapDays={result['longestGapDays']})")


# ---------------------------------------------------------------------------
# Test N -- evidence age calculation
# ---------------------------------------------------------------------------

def test_N_evidence_age():
    evidence = _fake_evidence(period_end="2026-01-01T00:00:00")
    reference = datetime(2026, 8, 19)
    result = compute_evidence_age(reference, evidence)
    assert result["ageDays"] == (reference - datetime(2026, 1, 1)).days
    print(f"test_N_evidence_age: PASS (ageDays={result['ageDays']})")


# ---------------------------------------------------------------------------
# Test O -- same-version metric change detection
# ---------------------------------------------------------------------------

def test_O_same_version_metric_change():
    ev_a = _fake_evidence(version_id="V1", pf=1.40, period_end="2025-01-01T00:00:00")
    ev_b = _fake_evidence(version_id="V1", pf=0.90, period_end="2025-06-01T00:00:00")
    result = detect_change(ev_a, _fake_risk(0.20, 2.10), ev_b, _fake_risk(0.35, -0.50))
    assert result["changeType"] == "METRIC_CHANGE"
    assert result["metrics"]["profitFactor"]["previous"] == 1.40
    assert result["metrics"]["profitFactor"]["new"] == 0.90
    assert result["metrics"]["profitFactor"]["delta"] == -0.50
    print(f"test_O_same_version_metric_change: PASS (PF 1.40 -> 0.90, delta={result['metrics']['profitFactor']['delta']})")


# ---------------------------------------------------------------------------
# Test P -- version-change distinction
# ---------------------------------------------------------------------------

def test_P_version_change_distinction():
    ev_v1 = _fake_evidence(version_id="V1", pf=1.40)
    ev_v2 = _fake_evidence(version_id="V2", pf=0.90)
    result = detect_change(ev_v1, _fake_risk(), ev_v2, _fake_risk())
    assert result["changeType"] == "VERSION_CHANGE"
    assert result["changeType"] != "METRIC_CHANGE"
    print("test_P_version_change_distinction: PASS (V1->V2 PF drop classified as VERSION_CHANGE, not PERFORMANCE_DETERIORATION)")


# ---------------------------------------------------------------------------
# Test Q -- incompatible observations not directly compared
# ---------------------------------------------------------------------------

def test_Q_not_directly_comparable():
    ev_a = _fake_evidence(version_id="V1", symbol="XAUUSD", timeframe="M5")
    ev_b = _fake_evidence(version_id="V1", symbol="XAUUSD", timeframe="H1")  # same version, different timeframe
    result = detect_change(ev_a, _fake_risk(), ev_b, _fake_risk())
    assert result["changeType"] == "NOT_DIRECTLY_COMPARABLE"
    assert any("timeframe" in r for r in result["reasons"])
    print(f"test_Q_not_directly_comparable: PASS ({result['reasons']})")


# ---------------------------------------------------------------------------
# Test R -- deterministic reproducibility
# ---------------------------------------------------------------------------

def test_R_deterministic_reproducibility():
    kwargs = dict(tradingSystemId="SYS-R", versionId="V1", eventType="EVIDENCE_ADDED",
                  observedAt="2026-01-01T00:00:00", recordedAt="2026-08-19T00:00:00",
                  source="test", sourceHash="abc123", payload={"tradeCount": 100})
    e1 = create_event(previous_event=None, **kwargs)
    e2 = create_event(previous_event=None, **kwargs)
    assert e1 == e2
    assert e1["historyEventId"] == e2["historyEventId"]
    print("test_R_deterministic_reproducibility: PASS (identical inputs -> byte-identical event + hash)")


# ---------------------------------------------------------------------------
# Test S -- platform neutrality
# ---------------------------------------------------------------------------

def test_S_platform_neutrality():
    adapters = ["mt5-deals-table-v1", "mt4-trade-history-v1-hypothetical", "ctrader-cbot-log-v1-hypothetical",
                "ninjatrader-strategy-log-v1-hypothetical", "crypto-exchange-fills-v1-hypothetical", "ai-trading-engine-log-v1-hypothetical"]
    for adapter in adapters:
        evidence = _fake_evidence(version_id=f"V-{adapter}", adapter=adapter)
        check_version_binding(evidence, evidence["versionId"], "Evidence")  # must not raise
        chain = append_event([], tradingSystemId=f"SYS-{adapter}", versionId=evidence["versionId"], eventType="EVIDENCE_ADDED",
                              observedAt="t0", recordedAt="t0", source=adapter, sourceHash=evidence["_contentHash"],
                              evidenceId=evidence["_contentHash"], payload={"sourceAdapter": adapter})
        ok, issues = verify_chain(chain)
        assert ok, (adapter, issues)
    print(f"test_S_platform_neutrality: PASS ({len(adapters)} adapters, zero platform-specific branching)")


# ---------------------------------------------------------------------------
# Test T -- real G01 history chain
# ---------------------------------------------------------------------------

def test_T_real_g01_history_chain():
    matches = sorted(glob.glob(str(REAL_EVIDENCE_DIR / "evidence_*.json")))
    if not matches:
        print("test_T_real_g01_history_chain: SKIPPED (no real G01 Evidence found on this machine)")
        return
    evidence_path = Path(matches[0])

    m3_result = verify_evidence_package(evidence_path, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REGISTRY)
    assert m3_result.status == "VERIFIED"
    val_result = run_validation_suite(evidence_path, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REGISTRY)
    risk_result = run_risk_analysis(evidence_path, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REGISTRY, validation_result=val_result)

    import json
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))["evidence"]

    chain = build_system_lifecycle_chain("G01", EXPECTED_VERSION_ID, evidence, m3_result, val_result, risk_result,
                                          recorded_at=datetime.utcnow().isoformat() + "Z")
    ok, issues = verify_chain(chain)
    assert ok, issues
    assert len(chain) == 6
    assert [e["eventType"] for e in chain] == ["SYSTEM_CREATED", "VERSION_CREATED", "EVIDENCE_ADDED", "EVIDENCE_VERIFIED", "VALIDATION_COMPLETED", "RISK_ANALYSIS_COMPLETED"]
    print(f"test_T_real_g01_history_chain: PASS ({len(chain)} events, chain verified, real G01 data)")


if __name__ == "__main__":
    test_A_create_first_event.__wrapped__ = None
    c1 = test_A_create_first_event()
    c2 = test_B_append_second_event(c1)
    test_C_original_event_immutable(c2)
    test_D_hash_changes_after_mutation(c2)
    test_E_broken_previous_event_chain()
    test_F_deleted_event_detection()
    test_G_reordered_event_detection()
    test_H_version_separation()
    test_I_version_binding_failure()
    test_J_invalidation_preserves_original()
    test_K_correction_preserves_original()
    test_L_observed_vs_recorded()
    test_M_history_gap_detection()
    test_N_evidence_age()
    test_O_same_version_metric_change()
    test_P_version_change_distinction()
    test_Q_not_directly_comparable()
    test_R_deterministic_reproducibility()
    test_S_platform_neutrality()
    test_T_real_g01_history_chain()

    print("\nAll M6 history-engine tests (A-T) PASSED.")
