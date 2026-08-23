// services/marketplace/factory/mt5EvidenceAdapter.ts
// Sprint M9 - MT5-specific evidence discovery. This is the ONLY file in
// the Factory allowed to know about MT5 specifics (M9 brief section 3) -
// ProductFactory/ingestion.ts/eligibility.ts never branch on platform.
//
// Sprint M12 branding follow-on (Phase 2) - primary source is now the
// real MarketplaceEvidenceRecord DB table (prisma/schema.prisma), written
// only by scripts/load-marketplace-evidence.ts after an AT24 human runs
// the real M2-M7 engines - never seller-writable. The old flat-file
// convention (data/marketplace-evidence/*.json, from Phase 1 the same
// session) is kept as a fallback, not removed - both G01 and PDHPDL-GOLD
// are loaded into the DB now, but this avoids a hard cutover if a future
// product's snapshot only exists as a file.
//
// No `import "server-only"` here (unlike MarketplaceCatalogue.ts, which
// needs it as its primary defense against accidental client bundling of a
// Prisma call). This module's node:fs/node:path/Prisma imports already
// make it unbundleable into any Client Component by construction - Next's
// client bundler errors on `fs` before ever reaching this file's own
// logic - and its only two importers (adapters.ts -> the [id]/submit
// route handler, and validate-marketplace-factory.ts) are both inherently
// server-side already. Keeping the marker off is what makes this file
// (and the ingestion pipeline that depends on it) testable by a plain tsx
// script at all - see that script's own top-of-file note on the
// "server-only" package not being resolvable outside Next's bundler.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
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

// DB-first lookup: a row in MarketplaceEvidenceRecord (real, AT24-written
// only) always wins when present. Falls back to the file convention
// (Phase 1) so a product with only a snapshot file still works. A lookup
// for any id pair with neither is honestly EVIDENCE_INGESTION_UNAVAILABLE,
// never fabricated.
export async function discoverMt5Evidence(tradingSystemId: string, versionId: string): Promise<MT5EvidenceSnapshot | null> {
  const row = await prisma.marketplaceEvidenceRecord
    .findUnique({ where: { tradingSystemId_versionId: { tradingSystemId, versionId } } })
    .catch(() => null);
  if (row) {
    return {
      tradingSystemId: row.tradingSystemId,
      versionId: row.versionId,
      m3: { status: "VERIFIED", evidenceId: row.evidenceId, warnings: [] },
      m4: { overallStatus: row.validationOverallStatus, evidenceId: row.evidenceId, recordStatuses: {} },
      m5: { status: row.riskStatus, riskAnalysisId: row.riskAnalysisId, riskAnalysisHash: row.riskAnalysisHash, dataQuality: {} },
      m7: { status: row.trustState, reasonCode: row.trustReasonCode, explanation: row.trustExplanation, id: row.trustStatusId, generatedAt: row.updatedAt.toISOString() },
      evidenceId: row.evidenceId,
      evidenceHash: row.evidenceHash,
      validationId: row.validationId,
      validationHash: row.validationHash,
      riskAnalysisId: row.riskAnalysisId,
      riskAnalysisHash: row.riskAnalysisHash,
      trustStatusId: row.trustStatusId,
      lastEvidenceAt: row.lastEvidenceAt ? row.lastEvidenceAt.toISOString() : null,
    };
  }
  return loadSnapshot(snapshotFilename(tradingSystemId, versionId));
}

// The MT5 PlatformAdapter's discoverEvidence implementation - flattens
// MT5EvidenceSnapshot's M3/M4/M5/M7-nested shape into the generic
// PlatformEvidenceSnapshot contract ingestion.ts consumes, so ingestion.ts
// never needs to know MT5's internal shape (or that MT5 exists at all).
export async function mt5DiscoverEvidence(tradingSystemId: string, versionId: string): Promise<PlatformEvidenceSnapshot | null> {
  const snapshot = await discoverMt5Evidence(tradingSystemId, versionId);
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
