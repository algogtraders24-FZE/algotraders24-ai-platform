// services/marketplace/factory/mt5EvidenceAdapter.ts
// Sprint M9 - MT5-specific evidence discovery. This is the ONLY file in
// the Factory allowed to know about MT5 specifics (M9 brief section 3) -
// ProductFactory/ingestion.ts/eligibility.ts never branch on platform.
// Reads a REAL, generated snapshot of G01's actual M3/M4/M5/M7 result
// (ea-research/marketplace-research/m9-product-factory/
// generate_g01_integration_snapshot.py produced it by calling M3-M7's own
// existing functions - no new computation, no fabricated data). Currently
// this snapshot only exists for G01/v0.1 - looking up any other
// tradingSystemId/versionId honestly returns "not found", never a guess.
// No `import "server-only"` here (unlike MarketplaceCatalogue.ts, which
// needs it as its primary defense against accidental client bundling of a
// Prisma call). This module's node:fs/node:path imports already make it
// unbundleable into any Client Component by construction - Next's client
// bundler errors on `fs` before ever reaching this file's own logic - and
// its only two importers (adapters.ts -> the [id]/submit route handler,
// and this sprint's validate-marketplace-factory.ts script) are both
// inherently server-side already. Keeping the marker off is what makes
// this file (and the ingestion pipeline that depends on it) testable by a
// plain tsx script at all - see that script's own top-of-file note on the
// "server-only" package not being resolvable outside Next's bundler.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PlatformEvidenceSnapshot } from "@/types/marketplace-factory";

export interface MT5EvidenceSnapshot {
  tradingSystemId: string;
  versionId: string;
  m3: { status: string; evidenceId: string; warnings: string[] };
  m4: { overallStatus: string; evidenceId: string; recordStatuses: Record<string, string> };
  m5: { status: string; riskAnalysisId: string; riskAnalysisHash: string; dataQuality: Record<string, string> };
  m7: { status: string; reasonCode: string; explanation: string; id: string; generatedAt: string };
  evidenceId: string;
  evidenceHash: string;
  validationId: string;
  validationHash: string;
  riskAnalysisId: string;
  riskAnalysisHash: string;
  trustStatusId: string;
  lastEvidenceAt: string | null;
}

const SNAPSHOTS_DIR = join(process.cwd(), "data", "marketplace-evidence");

function loadSnapshot(filename: string): MT5EvidenceSnapshot | null {
  try {
    const raw = readFileSync(join(SNAPSHOTS_DIR, filename), "utf-8");
    return JSON.parse(raw) as MT5EvidenceSnapshot;
  } catch {
    return null;
  }
}

// Filesystem-safe encoding of an id pair into the one filename convention
// every snapshot in SNAPSHOTS_DIR follows: "<tradingSystemId>__<versionId>.json".
// Only alnum/-/. survive; everything else (spaces, parens, slashes in a
// versionId's free-text description) becomes "_" - deterministic in both
// directions isn't required, this only ever needs to go id -> filename.
function snapshotFilename(tradingSystemId: string, versionId: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9.-]/g, "_");
  return `${safe(tradingSystemId)}__${safe(versionId)}.json`;
}

// Generalized lookup (M12 branding follow-on): any tradingSystemId/versionId
// with a matching snapshot file in SNAPSHOTS_DIR is discovered - no longer
// hardcoded to one product. A snapshot only ever exists here because an
// AT24 human ran the real M2-M7 engines and placed it via
// scripts/assemble-marketplace-evidence-snapshot.ts (or by hand, same
// shape) - sellers have no write access to this directory or these DB
// columns, so this change is a discovery-scope fix, not a security
// change. A lookup for any id pair with no matching file is honestly
// EVIDENCE_INGESTION_UNAVAILABLE, never fabricated.
export function discoverMt5Evidence(tradingSystemId: string, versionId: string): MT5EvidenceSnapshot | null {
  return loadSnapshot(snapshotFilename(tradingSystemId, versionId));
}

// The MT5 PlatformAdapter's discoverEvidence implementation - flattens
// MT5EvidenceSnapshot's M3/M4/M5/M7-nested shape into the generic
// PlatformEvidenceSnapshot contract ingestion.ts consumes, so ingestion.ts
// never needs to know MT5's internal shape (or that MT5 exists at all).
export function mt5DiscoverEvidence(tradingSystemId: string, versionId: string): PlatformEvidenceSnapshot | null {
  const snapshot = discoverMt5Evidence(tradingSystemId, versionId);
  if (!snapshot) return null;
  return {
    evidenceId: snapshot.evidenceId,
    evidenceHash: snapshot.evidenceHash,
    validationId: snapshot.validationId,
    validationHash: snapshot.validationHash,
    validationOverallStatus: snapshot.m4.overallStatus,
    riskAnalysisId: snapshot.riskAnalysisId,
    riskAnalysisHash: snapshot.riskAnalysisHash,
    riskStatus: snapshot.m5.status,
    trustState: snapshot.m7.status,
    trustReasonCode: snapshot.m7.reasonCode,
    trustExplanation: snapshot.m7.explanation,
    trustStatusId: snapshot.m7.id,
    lastEvidenceAt: snapshot.lastEvidenceAt,
  };
}
