// services/marketplace/factory/ingestion.ts
// Sprint M9 - Generic Factory ingestion pipeline (M9 brief section 7).
// Every stage is independently observable; a failure always names its
// exact stage (FAILED_AT_<STAGE>), never a generic PRODUCT_INVALID. This
// file contains literally zero platform-name string literals - Evidence
// discovery calls adapter.discoverEvidence(...), a function every
// PlatformAdapter implements (the five without a real one just return
// null), so this pipeline runs the identical code path for all six
// platforms (M9 brief section 27 platform-neutrality; proven by Test AF).
// All MT5-specific logic lives only in mt5EvidenceAdapter.ts.
import { getAdapter } from "./adapters";
import type { FailedAtStage, IngestionResult, IngestionStage, StageResult } from "@/types/marketplace-factory";

export interface IngestionInput {
  title: string;
  description: string;
  platformTag: string;
  tradingSystemId: string | null;
  versionId: string | null;
}

function fail(stage: IngestionStage, detail: string): { stageResult: StageResult; failedAt: FailedAtStage } {
  return { stageResult: { stage, status: "FAIL", detail }, failedAt: `FAILED_AT_${stage}` };
}

function pass(stage: IngestionStage, detail: string): StageResult {
  return { stage, status: "PASS", detail };
}

const EMPTY_REFS = {
  evidenceId: null, evidenceHash: null, validationId: null, validationHash: null,
  riskAnalysisId: null, riskAnalysisHash: null, trustState: null, trustReasonCode: null,
  trustExplanation: null, trustStatusId: null, lastEvidenceAt: null,
  validationOverallStatus: null, riskStatus: null,
} as const;

export function runIngestionPipeline(input: IngestionInput): IngestionResult {
  const stages: StageResult[] = [];

  // 1. SCHEMA_VALIDATION
  if (!input.title.trim() || !input.description.trim()) {
    const { stageResult, failedAt } = fail("SCHEMA_VALIDATION", "title and description are both required before ingestion can proceed.");
    return { stages: [stageResult], failedAt, ...EMPTY_REFS };
  }
  stages.push(pass("SCHEMA_VALIDATION", "title and description present."));

  // 2. PLATFORM_VALIDATION
  const adapter = getAdapter(input.platformTag);
  if (!adapter) {
    const { stageResult, failedAt } = fail("PLATFORM_VALIDATION", `Unknown platform "${input.platformTag}" -- no registered PlatformAdapter.`);
    return { stages: [...stages, stageResult], failedAt, ...EMPTY_REFS };
  }
  stages.push(pass("PLATFORM_VALIDATION", `Platform "${adapter.platform}" recognized.`));

  // 3. TRADING_SYSTEM_BINDING
  if (!input.tradingSystemId) {
    const { stageResult, failedAt } = fail("TRADING_SYSTEM_BINDING", "No tradingSystemId supplied -- cannot bind this submission to a TradingSystem.");
    return { stages: [...stages, stageResult], failedAt, ...EMPTY_REFS };
  }
  stages.push(pass("TRADING_SYSTEM_BINDING", `Bound to tradingSystemId=${input.tradingSystemId}.`));

  // 4. VERSION_BINDING
  if (!input.versionId) {
    const { stageResult, failedAt } = fail("VERSION_BINDING", "No versionId supplied -- cannot bind this submission to a Version.");
    return { stages: [...stages, stageResult], failedAt, ...EMPTY_REFS };
  }
  stages.push(pass("VERSION_BINDING", `Bound to versionId=${input.versionId}.`));

  // 5. EVIDENCE_DISCOVERY
  if (!adapter.evidenceIngestionSupported) {
    const { stageResult, failedAt } = fail("EVIDENCE_DISCOVERY", `EVIDENCE_INGESTION_UNAVAILABLE: platform "${adapter.platform}" has no evidence-ingestion adapter yet.`);
    return { stages: [...stages, stageResult], failedAt, ...EMPTY_REFS };
  }
  const snapshot = adapter.discoverEvidence(input.tradingSystemId, input.versionId);
  if (!snapshot) {
    const { stageResult, failedAt } = fail("EVIDENCE_DISCOVERY", `No Evidence snapshot found for tradingSystemId=${input.tradingSystemId} versionId=${input.versionId}.`);
    return { stages: [...stages, stageResult], failedAt, ...EMPTY_REFS };
  }
  stages.push(pass("EVIDENCE_DISCOVERY", `Evidence discovered: ${snapshot.evidenceId}.`));

  // 6. VALIDATION_DISCOVERY
  stages.push(pass("VALIDATION_DISCOVERY", `Validation discovered: ${snapshot.validationId} (overallStatus: ${snapshot.validationOverallStatus}).`));

  // 7. RISK_DISCOVERY
  stages.push(pass("RISK_DISCOVERY", `RiskAnalysis discovered: ${snapshot.riskAnalysisId} (status: ${snapshot.riskStatus}).`));

  // 8. HISTORY_DISCOVERY
  stages.push(pass("HISTORY_DISCOVERY", `lastEvidenceAt=${snapshot.lastEvidenceAt ?? "unknown"}.`));

  // 9. TRUST_EVALUATION
  stages.push(pass("TRUST_EVALUATION", `Trust State: ${snapshot.trustState} (${snapshot.trustReasonCode}).`));

  return {
    stages,
    failedAt: null,
    evidenceId: snapshot.evidenceId,
    evidenceHash: snapshot.evidenceHash,
    validationId: snapshot.validationId,
    validationHash: snapshot.validationHash,
    riskAnalysisId: snapshot.riskAnalysisId,
    riskAnalysisHash: snapshot.riskAnalysisHash,
    trustState: snapshot.trustState,
    trustReasonCode: snapshot.trustReasonCode,
    trustExplanation: snapshot.trustExplanation,
    trustStatusId: snapshot.trustStatusId,
    lastEvidenceAt: snapshot.lastEvidenceAt,
    validationOverallStatus: snapshot.validationOverallStatus,
    riskStatus: snapshot.riskStatus,
  };
}
