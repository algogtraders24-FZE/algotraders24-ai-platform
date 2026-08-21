// scripts/assemble-marketplace-evidence-snapshot.ts
// Sprint M12 branding follow-on - Phase 1 of the evidence-discovery
// generalization (see mt5EvidenceAdapter.ts). Takes the real M3-M7 chain
// result JSON that the generate_*_evidence_chain.py scripts already
// produce (ea-research/marketplace-research/*/*.py, same shape as
// pdhpdl_gold_extended_evidence_chain_result.json) and writes it into
// data/marketplace-evidence/ under the exact filename convention
// mt5EvidenceAdapter.ts's discoverMt5Evidence now looks up by:
// "<tradingSystemId>__<versionId>.json". No new computation happens here -
// this is a pure reshape/copy step, run by an AT24 human after a real
// M2-M7 chain finishes, same trust boundary as before (sellers never
// touch this).
//
// Usage: npx tsx scripts/assemble-marketplace-evidence-snapshot.ts <path-to-chain-result.json>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SNAPSHOTS_DIR = join(__dirname, "..", "data", "marketplace-evidence");

function safe(s: string): string {
  return s.replace(/[^a-zA-Z0-9.-]/g, "_");
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: npx tsx scripts/assemble-marketplace-evidence-snapshot.ts <path-to-chain-result.json>");
    process.exit(1);
  }

  const chain = JSON.parse(readFileSync(inputPath, "utf-8"));
  const required = ["tradingSystemId", "versionId", "m3", "m4", "m5", "m7", "evidenceId", "evidenceHash", "validationId", "riskAnalysisId"];
  for (const key of required) {
    if (!(key in chain)) throw new Error(`Chain result is missing required field "${key}" - not a valid M3-M7 chain result.`);
  }

  const snapshot = {
    tradingSystemId: chain.tradingSystemId,
    versionId: chain.versionId,
    m3: { status: chain.m3.status, evidenceId: chain.m3.evidenceId, warnings: chain.m3.warnings ?? [] },
    m4: { overallStatus: chain.m4.overallStatus, evidenceId: chain.m4.evidenceId, recordStatuses: chain.m4.recordStatuses },
    m5: { status: chain.m5.status, riskAnalysisId: chain.m5.riskAnalysisId, riskAnalysisHash: chain.m5.riskAnalysisHash, dataQuality: chain.m5.dataQuality },
    m7: { status: chain.m7.status, reasonCode: chain.m7.reasonCode, explanation: chain.m7.explanation, id: chain.m7.id, generatedAt: chain.m7.generatedAt },
    evidenceId: chain.evidenceId,
    evidenceHash: chain.evidenceHash,
    validationId: chain.validationId,
    // validationHash: no separate value exists in this chain-result shape
    // (M4 validation is computed over the same Evidence content) - reuse
    // evidenceId, matching the convention the earlier v2.0 chain result
    // already used (validationHash === evidenceId there too).
    validationHash: chain.validationHash ?? chain.evidenceId,
    riskAnalysisId: chain.riskAnalysisId,
    riskAnalysisHash: chain.m5.riskAnalysisHash,
    trustStatusId: chain.trustStatusId,
    lastEvidenceAt: chain.lastEvidenceAt ?? null,
  };

  mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  const filename = `${safe(chain.tradingSystemId)}__${safe(chain.versionId)}.json`;
  const outPath = join(SNAPSHOTS_DIR, filename);
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2), "utf-8");
  console.log(`Wrote ${outPath}`);
}

main();
