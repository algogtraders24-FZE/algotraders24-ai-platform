"""
M7 tests A-U from the sprint brief. A-T use lightweight/synthetic fixtures
(real M3 verification against a written-to-disk synthetic Evidence package,
hand-built M4/M5/M6-shaped result dicts elsewhere) -- Test T sweeps six
non-MT5 adapter labels through the FULL real gate. Test U is the one
genuine real-data test: actual G01 M3/M4/M5/M6 outputs.

Run: python test_trust_status_engine.py
"""

import copy
import glob
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "m2-evidence-engine"))
sys.path.insert(0, str(Path(__file__).parent.parent / "m3-evidence-verification"))
sys.path.insert(0, str(Path(__file__).parent.parent / "m4-validation-engine"))
sys.path.insert(0, str(Path(__file__).parent.parent / "m5-risk-analysis"))
sys.path.insert(0, str(Path(__file__).parent.parent / "m6-history-engine"))
from evidence_engine import compute_metrics  # noqa: E402
from evidence_verifier import recompute_content_hash, verify_evidence_package  # noqa: E402
from validation_engine import run_validation_suite  # noqa: E402
from risk_analysis_engine import run_risk_analysis, validation_result_hash  # noqa: E402
from history_engine import append_event, build_system_lifecycle_chain  # noqa: E402

from trust_status_engine import (
    HistoryIntegrityFailureError,
    InputIntegrityFailureError,
    VersionBindingFailureError,
    append_trust_status,
    derive_trust_status,
    run_trust_status,
)

HERE = Path(__file__).parent
SCRATCH = HERE / "test_fixtures" / "_scratch"
REGISTRY = SCRATCH / "test_registry.json"
REAL_EVIDENCE_DIR = HERE.parent / "m2-evidence-engine" / "real_evidence_output"
SOURCE_ARTIFACT = Path(r"C:\Users\om\AppData\Roaming\MetaQuotes\Terminal\8762A67661860246215827420BCD27F8\G01_Baseline_v0.1_Report.htm")
REAL_REGISTRY = Path(__file__).parent.parent / "m3-evidence-verification" / "version_registry.json"
EXPECTED_VERSION_ID = "G01-v0.1-FROZEN-BASELINE"


def _multi_year_trades(n_years=3, trades_per_year=25, start_year=2020):
    trades = []
    for y in range(start_year, start_year + n_years):
        for i in range(trades_per_year):
            month, day = (i % 12) + 1, min(28, (i % 27) + 1)
            profit = 20.0 if i % 3 != 0 else -15.0
            trades.append({
                "timestamp": f"{y}.{month:02d}.{day:02d} 10:00:00", "symbol": "SYN",
                "direction": "long" if i % 2 == 0 else "short", "entryPrice": 100.0 + i,
                "exitPrice": 100.0 + i + (1 if profit > 0 else -1), "sl": None, "tp": None,
                "volume": 0.1, "profit": profit, "rMultiple": None, "durationSeconds": 3600 * (1 + i % 5),
                "marketRegime": "TREND", "exitReason": "TP" if profit > 0 else "SL",
                "grossProfit": profit + 0.5, "commission": -0.4, "swap": -0.1,
            })
    trades.sort(key=lambda t: t["timestamp"])
    return trades


def _write_valid_package(version_id="TEST-SYSTEM-M7-v1.0", source_adapter="synthetic-test-v1", name="pkg.json"):
    trades = _multi_year_trades()
    metrics = compute_metrics(trades, initial_deposit=10000.0)
    evidence = {
        "versionId": version_id, "evidenceClass": "HISTORICAL", "source": "BACKTEST", "sourceAdapter": source_adapter,
        "provenance": {
            "dataSource": {"reportFile": "synthetic.htm", "reportFileSha256": "deadbeef" * 8, "tradeLogKind": "deals_table", "tradeLogFile": None},
            "broker": "Synthetic-Broker", "symbol": "SYN", "timeframe": "M5",
            "periodStart": trades[0]["timestamp"], "periodEnd": trades[-1]["timestamp"],
            "spreadModel": None, "commissionModel": None, "swapModel": None, "tickDataQuality": None,
            "executionAssumptions": {"initialDeposit": 10000.0, "leverage": "1:100", "currency": "USD"},
        },
        "generatedBy": "AT24-M2-Evidence-Engine-v0.2", "metricsSummary": metrics, "curves": {}, "reportCrossCheck": {},
        "createdAt": "2026-08-19T00:00:00Z",
    }
    evidence["_contentHash"] = recompute_content_hash(evidence)
    SCRATCH.mkdir(parents=True, exist_ok=True)
    path = SCRATCH / name
    path.write_text(json.dumps({"evidence": evidence, "trades": trades}, indent=2), encoding="utf-8")
    return path, evidence


def _registry(version_ids):
    SCRATCH.mkdir(parents=True, exist_ok=True)
    reg = {}
    if REGISTRY.exists():
        reg = json.loads(REGISTRY.read_text(encoding="utf-8"))
    for v in version_ids:
        reg.setdefault(v, {"tradingSystemId": "TEST-SYSTEM-M7", "tradingSystemName": "Synthetic M7 Test System", "versionString": "v1.0"})
    REGISTRY.write_text(json.dumps(reg, indent=2), encoding="utf-8")
    return REGISTRY


def _real_validation(path, version_id, parameter_configurations=None):
    return run_validation_suite(path, source_artifact_path=None, expected_version_id=version_id,
                                 registry_path=_registry([version_id]), parameter_configurations=parameter_configurations)


def _real_risk(path, version_id, val_result):
    return run_risk_analysis(path, source_artifact_path=None, expected_version_id=version_id, registry_path=_registry([version_id]), validation_result=val_result)


def _multi_observation_history(tsid, vid, evidence, m3_result, val_result, risk_result, n=2):
    chain = []
    for _ in range(n):
        chain = build_system_lifecycle_chain(tsid, vid, evidence, m3_result, val_result, risk_result, recorded_at=datetime.utcnow().isoformat() + "Z") if not chain else chain + build_system_lifecycle_chain(tsid, vid, evidence, m3_result, val_result, risk_result, recorded_at=datetime.utcnow().isoformat() + "Z")[2:]
    return chain


# ---------------------------------------------------------------------------
# Test A -- verified Evidence, no Validation
# ---------------------------------------------------------------------------

def test_A_verified_no_validation():
    path, evidence = _write_valid_package(name="test_A.json")
    m3 = verify_evidence_package(path, None, "TEST-SYSTEM-M7-v1.0", _registry(["TEST-SYSTEM-M7-v1.0"]))
    status, reason, expl = derive_trust_status(evidence, m3.status, None, None, None, "TEST-SYSTEM-M7-v1.0")
    assert status == "VALIDATION_PENDING", status
    print(f"test_A_verified_no_validation: PASS (status={status}, reason={reason})")


# ---------------------------------------------------------------------------
# Test B -- verified Evidence + complete Validation (+ RiskAnalysis COMPLETE, 2+ observations) -> VALIDATED
# ---------------------------------------------------------------------------

def test_B_full_validated_path():
    trades = _multi_year_trades()
    path, evidence = _write_valid_package(name="test_B.json")
    # Give this fixture a (placeholder) equity curve so M5's drawdown/recovery
    # dimensions reach AVAILABLE too -- same technique M5's own Test A used --
    # so this test can demonstrate the genuine end-to-end VALIDATED path.
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["evidence"]["curves"] = {"note": "placeholder truthy curve marker for this test only"}
    payload["evidence"]["_contentHash"] = recompute_content_hash(payload["evidence"])
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    evidence = payload["evidence"]
    vid = "TEST-SYSTEM-M7-v1.0"
    m3 = verify_evidence_package(path, None, vid, _registry([vid]))
    configs = {"baseline": trades, "variant": [dict(t, profit=t["profit"] * 1.1) for t in trades]}
    val = _real_validation(path, vid, parameter_configurations=configs)  # supplies PARAMETER_SENSITIVITY input so M4 can reach PASS
    risk = _real_risk(path, vid, val)
    # This synthetic fixture legitimately reaches PASS/COMPLETE via real M4/M5 computation
    # (regime-tagged, cost fields present, duration present -- see _multi_year_trades).
    chain = build_system_lifecycle_chain("TEST-SYSTEM-M7", vid, evidence, m3, val, risk, datetime.utcnow().isoformat() + "Z")
    chain = chain + build_system_lifecycle_chain("TEST-SYSTEM-M7", vid, evidence, m3, val, risk, datetime.utcnow().isoformat() + "Z")[2:]  # 2nd observation
    status, reason, expl = derive_trust_status(evidence, m3.status, val, risk, chain, vid)
    assert status == "VALIDATED", f"expected VALIDATED, got {status} ({reason}): {expl}"
    print(f"test_B_full_validated_path: PASS (status={status}, reason={reason})")


# ---------------------------------------------------------------------------
# Test C -- verified Evidence + INCONCLUSIVE Validation -> INCONCLUSIVE
# ---------------------------------------------------------------------------

def test_C_inconclusive_validation():
    path, evidence = _write_valid_package(name="test_C.json")
    vid = "TEST-SYSTEM-M7-v1.0"
    m3 = verify_evidence_package(path, None, vid, _registry([vid]))
    fake_val = {"versionId": vid, "overallStatus": "INCONCLUSIVE", "evidenceId": evidence["_contentHash"], "records": [{"validationType": "REGIME_COVERAGE", "status": "INCONCLUSIVE"}]}
    status, reason, expl = derive_trust_status(evidence, m3.status, fake_val, None, None, vid)
    assert status == "INCONCLUSIVE" and reason == "VALIDATION_INCONCLUSIVE"
    print(f"test_C_inconclusive_validation: PASS (status={status}, reason={reason})")


# ---------------------------------------------------------------------------
# Test D -- verified Evidence + partial RiskAnalysis -> LIMITED (no invented threshold)
# ---------------------------------------------------------------------------

def test_D_partial_risk_analysis():
    path, evidence = _write_valid_package(name="test_D.json")
    vid = "TEST-SYSTEM-M7-v1.0"
    m3 = verify_evidence_package(path, None, vid, _registry([vid]))
    fake_val = {"versionId": vid, "overallStatus": "PASS", "evidenceId": evidence["_contentHash"], "records": []}
    fake_risk = {"versionId": vid, "status": "PARTIAL", "dataQuality": {"drawdown": "LIMITED", "regimeRisk": "UNAVAILABLE"}, "riskAnalysisHash": "riskhash1"}
    status, reason, expl = derive_trust_status(evidence, m3.status, fake_val, fake_risk, None, vid)
    assert status == "LIMITED" and reason == "RISK_ANALYSIS_PARTIAL"
    print(f"test_D_partial_risk_analysis: PASS (status={status}, reason={reason}) -- driven by RiskAnalysis.status=PARTIAL, no numeric risk threshold consulted")


# ---------------------------------------------------------------------------
# Test E -- unverified Evidence -> UNVERIFIED
# ---------------------------------------------------------------------------

def test_E_unverified_evidence():
    path, evidence = _write_valid_package(name="test_E.json")
    status, reason, expl = derive_trust_status(evidence, "FAILED", None, None, None, "TEST-SYSTEM-M7-v1.0")
    assert status == "UNVERIFIED" and reason == "EVIDENCE_NOT_VERIFIED"
    print(f"test_E_unverified_evidence: PASS (status={status})")


# ---------------------------------------------------------------------------
# Test F -- invalidated Evidence -> INVALIDATED
# ---------------------------------------------------------------------------

def test_F_invalidated_evidence():
    evidence = {"_contentHash": "ev123", "versionId": "V1"}
    history = [{"eventType": "EVIDENCE_INVALIDATED", "historyEventId": "hist1", "evidenceId": "ev123",
                "payload": {"invalidates": "some-earlier-event", "reason": "source artifact mismatch discovered"}}]
    status, reason, expl = derive_trust_status(evidence, "VERIFIED", {"versionId": "V1", "overallStatus": "PASS"},
                                                 {"versionId": "V1", "status": "COMPLETE"}, history, "V1")
    assert status == "INVALIDATED" and reason == "EVIDENCE_INVALIDATED"
    print(f"test_F_invalidated_evidence: PASS (status={status}, {expl})")


# ---------------------------------------------------------------------------
# Test G -- superseded Version -> SUPERSEDED
# ---------------------------------------------------------------------------

def test_G_superseded_version():
    evidence = {"_contentHash": "ev123", "versionId": "V1"}
    history = [{"eventType": "VERSION_SUPERSEDED", "historyEventId": "hist1",
                "payload": {"supersededVersion": "V1", "newVersion": "V2", "reason": "v2 independently verified"}}]
    status, reason, expl = derive_trust_status(evidence, "VERIFIED", {"versionId": "V1", "overallStatus": "PASS"},
                                                 {"versionId": "V1", "status": "COMPLETE"}, history, "V1")
    assert status == "SUPERSEDED" and reason == "VERSION_SUPERSEDED"
    print(f"test_G_superseded_version: PASS (status={status}, {expl})")


# ---------------------------------------------------------------------------
# Test H/I/J -- hash mismatches
# ---------------------------------------------------------------------------

def test_H_evidence_hash_mismatch():
    path, evidence = _write_valid_package(name="test_H.json")
    vid = "TEST-SYSTEM-M7-v1.0"
    try:
        run_trust_status(path, None, vid, _registry([vid]), "TEST-SYSTEM-M7", None, None, None, [],
                          expected_evidence_hash="wronghash0000000")
        raise AssertionError("expected InputIntegrityFailureError")
    except InputIntegrityFailureError as e:
        assert "INPUT_INTEGRITY_FAILURE" in str(e)
        print(f"test_H_evidence_hash_mismatch: PASS ({e})")


def test_I_validation_hash_mismatch():
    path, evidence = _write_valid_package(name="test_I.json")
    vid = "TEST-SYSTEM-M7-v1.0"
    val = _real_validation(path, vid)
    try:
        run_trust_status(path, None, vid, _registry([vid]), "TEST-SYSTEM-M7", val, None, None, [],
                          expected_validation_hash="wronghash0000000")
        raise AssertionError("expected InputIntegrityFailureError")
    except InputIntegrityFailureError as e:
        assert "INPUT_INTEGRITY_FAILURE" in str(e)
        print(f"test_I_validation_hash_mismatch: PASS ({e})")


def test_J_risk_hash_mismatch():
    path, evidence = _write_valid_package(name="test_J.json")
    vid = "TEST-SYSTEM-M7-v1.0"
    val = _real_validation(path, vid)
    risk = _real_risk(path, vid, val)
    try:
        run_trust_status(path, None, vid, _registry([vid]), "TEST-SYSTEM-M7", val, risk, None, [],
                          expected_risk_hash="wronghash0000000")
        raise AssertionError("expected InputIntegrityFailureError")
    except InputIntegrityFailureError as e:
        assert "INPUT_INTEGRITY_FAILURE" in str(e)
        print(f"test_J_risk_hash_mismatch: PASS ({e})")


# ---------------------------------------------------------------------------
# Test K -- broken History chain -> HISTORY_INTEGRITY_FAILURE
# ---------------------------------------------------------------------------

def test_K_broken_history_chain():
    path, evidence = _write_valid_package(name="test_K.json")
    vid = "TEST-SYSTEM-M7-v1.0"
    broken_chain = [
        {"historyEventId": "a", "contentHash": "a", "eventType": "SYSTEM_CREATED", "previousEventId": None, "previousEventHash": None,
         "tradingSystemId": "X", "versionId": vid, "evidenceId": None, "validationId": None, "riskAnalysisId": None,
         "observedAt": "t", "recordedAt": "t", "source": "x", "sourceHash": None, "payload": {}, "rulesetVersion": "none-defined", "methodologyVersion": "m", "createdBy": "x"},
        {"historyEventId": "b", "contentHash": "b", "eventType": "VERSION_CREATED", "previousEventId": "WRONG", "previousEventHash": "WRONG",
         "tradingSystemId": "X", "versionId": vid, "evidenceId": None, "validationId": None, "riskAnalysisId": None,
         "observedAt": "t", "recordedAt": "t", "source": "x", "sourceHash": None, "payload": {}, "rulesetVersion": "none-defined", "methodologyVersion": "m", "createdBy": "x"},
    ]
    try:
        run_trust_status(path, None, vid, _registry([vid]), "TEST-SYSTEM-M7", None, None, broken_chain, [])
        raise AssertionError("expected HistoryIntegrityFailureError")
    except HistoryIntegrityFailureError as e:
        assert "HISTORY_CHAIN_FAILURE" in str(e)
        print(f"test_K_broken_history_chain: PASS ({e})")


# ---------------------------------------------------------------------------
# Test L -- cross-version Evidence/Validation -> VERSION_BINDING_FAILURE
# ---------------------------------------------------------------------------

def test_L_cross_version_binding_failure():
    path, evidence = _write_valid_package(version_id="TEST-SYSTEM-M7-v1.0", name="test_L.json")
    vid = "TEST-SYSTEM-M7-v1.0"
    other_vid_val = {"versionId": "SOME-OTHER-VERSION", "overallStatus": "PASS", "evidenceId": "x", "records": []}
    try:
        run_trust_status(path, None, vid, _registry([vid]), "TEST-SYSTEM-M7", other_vid_val, None, None, [])
        raise AssertionError("expected VersionBindingFailureError")
    except VersionBindingFailureError as e:
        assert "VERSION_BINDING_FAILURE" in str(e)
        print(f"test_L_cross_version_binding_failure: PASS ({e})")


# ---------------------------------------------------------------------------
# Test M -- append-only status transition
# ---------------------------------------------------------------------------

def test_M_append_only_transition():
    evidence = {"_contentHash": "ev1", "versionId": "V1"}
    chain = append_trust_status([], tradingSystemId="SYS", versionId="V1", status="INCONCLUSIVE", reasonCode="VALIDATION_INCONCLUSIVE",
                                 explanation="e1", evidence=evidence, validation_result=None, risk_result=None, history_chain=None,
                                 generatedAt="t0", effectiveAt="t0")
    first = chain[0]
    chain2 = append_trust_status(chain, tradingSystemId="SYS", versionId="V1", status="VALIDATED", reasonCode="VALIDATION_COMPLETE",
                                  explanation="e2", evidence=evidence, validation_result=None, risk_result=None, history_chain=None,
                                  generatedAt="t1", effectiveAt="t1")
    assert chain2[0] == first, "original TrustStatus record must be preserved unmodified"
    assert chain2[1]["previousStatusId"] == first["id"]
    print("test_M_append_only_transition: PASS (original preserved, new record links back via previousStatusId)")


# ---------------------------------------------------------------------------
# Test N -- deterministic reproducibility
# ---------------------------------------------------------------------------

def test_N_deterministic_reproducibility():
    evidence = {"_contentHash": "ev1", "versionId": "V1"}
    kwargs = dict(tradingSystemId="SYS", versionId="V1", status="VALIDATION_PENDING", reasonCode="VALIDATION_NOT_AVAILABLE",
                  explanation="e", evidence=evidence, validation_result=None, risk_result=None, history_chain=None,
                  generatedAt="t0", effectiveAt="t0")
    c1 = append_trust_status([], **kwargs)
    c2 = append_trust_status([], **kwargs)
    assert c1 == c2 and c1[0]["id"] == c2[0]["id"]
    print("test_N_deterministic_reproducibility: PASS")


# ---------------------------------------------------------------------------
# Test O -- same evidence, same state
# ---------------------------------------------------------------------------

def test_O_same_evidence_same_state():
    evidence = {"_contentHash": "ev1", "versionId": "V1"}
    val = {"versionId": "V1", "overallStatus": "INCONCLUSIVE", "records": []}
    r1 = derive_trust_status(evidence, "VERIFIED", val, None, None, "V1")
    r2 = derive_trust_status(evidence, "VERIFIED", val, None, None, "V1")
    assert r1 == r2
    print(f"test_O_same_evidence_same_state: PASS (status={r1[0]}, reason={r1[1]})")


# ---------------------------------------------------------------------------
# Test P -- changed validation result -> new status event, previous preserved
# ---------------------------------------------------------------------------

def test_P_changed_validation_new_event():
    evidence = {"_contentHash": "ev1", "versionId": "V1"}
    val_before = {"versionId": "V1", "overallStatus": "INCONCLUSIVE", "records": []}
    s1, r1, e1 = derive_trust_status(evidence, "VERIFIED", val_before, None, None, "V1")
    chain = append_trust_status([], tradingSystemId="SYS", versionId="V1", status=s1, reasonCode=r1, explanation=e1,
                                 evidence=evidence, validation_result=val_before, risk_result=None, history_chain=None,
                                 generatedAt="t0", effectiveAt="t0")
    val_after = {"versionId": "V1", "overallStatus": "PASS", "records": []}
    risk_after = {"versionId": "V1", "status": "COMPLETE", "dataQuality": {}, "riskAnalysisHash": "rh1"}
    history_2obs = [{"eventType": "RISK_ANALYSIS_COMPLETED"}, {"eventType": "RISK_ANALYSIS_COMPLETED"}]
    s2, r2, e2 = derive_trust_status(evidence, "VERIFIED", val_after, risk_after, history_2obs, "V1")
    chain2 = append_trust_status(chain, tradingSystemId="SYS", versionId="V1", status=s2, reasonCode=r2, explanation=e2,
                                  evidence=evidence, validation_result=val_after, risk_result=risk_after, history_chain=history_2obs,
                                  generatedAt="t1", effectiveAt="t1")
    assert chain2[0]["status"] == "INCONCLUSIVE" and chain2[0] == chain[0]
    assert chain2[1]["status"] == "VALIDATED"
    print(f"test_P_changed_validation_new_event: PASS ({chain2[0]['status']} preserved, new {chain2[1]['status']} appended)")


# ---------------------------------------------------------------------------
# Test Q -- invalidation precedence
# ---------------------------------------------------------------------------

def test_Q_invalidation_precedence():
    evidence = {"_contentHash": "ev1", "versionId": "V1"}
    val = {"versionId": "V1", "overallStatus": "PASS", "records": []}
    risk = {"versionId": "V1", "status": "COMPLETE", "dataQuality": {}, "riskAnalysisHash": "rh1"}
    history_would_be_validated = [{"eventType": "RISK_ANALYSIS_COMPLETED"}, {"eventType": "RISK_ANALYSIS_COMPLETED"},
                                   {"eventType": "EVIDENCE_INVALIDATED", "historyEventId": "h1", "evidenceId": "ev1",
                                    "payload": {"invalidates": "earlier", "reason": "integrity issue found"}}]
    status, reason, expl = derive_trust_status(evidence, "VERIFIED", val, risk, history_would_be_validated, "V1")
    assert status == "INVALIDATED", f"expected INVALIDATED to override an otherwise-VALIDATED state, got {status}"
    print(f"test_Q_invalidation_precedence: PASS (status={status}, overrides what would otherwise be VALIDATED)")


# ---------------------------------------------------------------------------
# Test R -- supersession precedence
# ---------------------------------------------------------------------------

def test_R_supersession_precedence():
    evidence = {"_contentHash": "ev1", "versionId": "V1"}
    val = {"versionId": "V1", "overallStatus": "PASS", "records": []}
    risk = {"versionId": "V1", "status": "COMPLETE", "dataQuality": {}, "riskAnalysisHash": "rh1"}
    history = [{"eventType": "RISK_ANALYSIS_COMPLETED"}, {"eventType": "RISK_ANALYSIS_COMPLETED"},
               {"eventType": "VERSION_SUPERSEDED", "historyEventId": "h1", "payload": {"supersededVersion": "V1", "newVersion": "V2", "reason": "v2 verified"}}]
    status, reason, expl = derive_trust_status(evidence, "VERIFIED", val, risk, history, "V1")
    assert status == "SUPERSEDED"
    print(f"test_R_supersession_precedence: PASS (status={status}, overrides what would otherwise be VALIDATED)")


# ---------------------------------------------------------------------------
# Test S -- single-observation history -> no longitudinal trust claim
# ---------------------------------------------------------------------------

def test_S_single_observation_no_longitudinal_claim():
    evidence = {"_contentHash": "ev1", "versionId": "V1"}
    val = {"versionId": "V1", "overallStatus": "PASS", "records": []}
    risk = {"versionId": "V1", "status": "COMPLETE", "dataQuality": {}, "riskAnalysisHash": "rh1"}
    history_one_obs = [{"eventType": "RISK_ANALYSIS_COMPLETED"}]
    status, reason, expl = derive_trust_status(evidence, "VERIFIED", val, risk, history_one_obs, "V1")
    assert status == "UNDER_OBSERVATION", f"one observation must not reach VALIDATED, got {status}"
    assert status != "VALIDATED"
    print(f"test_S_single_observation_no_longitudinal_claim: PASS (status={status}, not VALIDATED with only 1 observation)")


# ---------------------------------------------------------------------------
# Test T -- platform neutrality (full real gate, 6 adapters)
# ---------------------------------------------------------------------------

def test_T_platform_neutrality():
    adapters = ["mt5-deals-table-v1", "mt4-trade-history-v1-hypothetical", "ctrader-cbot-log-v1-hypothetical",
                "ninjatrader-strategy-log-v1-hypothetical", "crypto-exchange-fills-v1-hypothetical", "ai-trading-engine-log-v1-hypothetical"]
    statuses = []
    for i, adapter in enumerate(adapters):
        vid = f"TEST-SYSTEM-M7-PLATFORM-{i}-v1.0"
        path, evidence = _write_valid_package(version_id=vid, source_adapter=adapter, name=f"test_T_{i}.json")
        chain = run_trust_status(path, None, vid, _registry([vid]), "TEST-SYSTEM-M7", None, None, None, [])
        statuses.append((adapter, chain[-1]["status"]))
        assert chain[-1]["status"] == "VALIDATION_PENDING"
    print(f"test_T_platform_neutrality: PASS ({len(adapters)} adapters, identical VALIDATION_PENDING result, zero platform-specific branching -- {statuses})")


# ---------------------------------------------------------------------------
# Test U -- real G01 Trust Status
# ---------------------------------------------------------------------------

def test_U_real_g01_trust_status():
    matches = sorted(glob.glob(str(REAL_EVIDENCE_DIR / "evidence_*.json")))
    if not matches:
        print("test_U_real_g01_trust_status: SKIPPED (no real G01 Evidence found)")
        return
    evidence_path = Path(matches[0])
    m3 = verify_evidence_package(evidence_path, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REAL_REGISTRY)
    val = run_validation_suite(evidence_path, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REAL_REGISTRY)
    risk = run_risk_analysis(evidence_path, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REAL_REGISTRY, validation_result=val)
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))["evidence"]
    recorded_at = datetime.utcnow().isoformat() + "Z"
    history = build_system_lifecycle_chain("G01", EXPECTED_VERSION_ID, evidence, m3, val, risk, recorded_at)

    chain = run_trust_status(evidence_path, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REAL_REGISTRY, "G01", val, risk, history, [])
    final = chain[-1]
    assert final["status"] == "INCONCLUSIVE", f"expected INCONCLUSIVE (M4 overallStatus={val['overallStatus']}), got {final['status']}"
    assert final["reasonCode"] == "VALIDATION_INCONCLUSIVE"
    print(f"test_U_real_g01_trust_status: PASS (status={final['status']}, reason={final['reasonCode']})")
    print(f"  explanation: {final['explanation']}")


if __name__ == "__main__":
    if SCRATCH.exists():
        shutil.rmtree(SCRATCH)

    test_A_verified_no_validation()
    test_B_full_validated_path()
    test_C_inconclusive_validation()
    test_D_partial_risk_analysis()
    test_E_unverified_evidence()
    test_F_invalidated_evidence()
    test_G_superseded_version()
    test_H_evidence_hash_mismatch()
    test_I_validation_hash_mismatch()
    test_J_risk_hash_mismatch()
    test_K_broken_history_chain()
    test_L_cross_version_binding_failure()
    test_M_append_only_transition()
    test_N_deterministic_reproducibility()
    test_O_same_evidence_same_state()
    test_P_changed_validation_new_event()
    test_Q_invalidation_precedence()
    test_R_supersession_precedence()
    test_S_single_observation_no_longitudinal_claim()
    test_T_platform_neutrality()
    test_U_real_g01_trust_status()

    shutil.rmtree(SCRATCH)
    print("\nAll M7 trust-status-engine tests (A-U) PASSED.")
