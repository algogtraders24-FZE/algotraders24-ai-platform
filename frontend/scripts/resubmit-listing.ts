// scripts/resubmit-listing.ts
// Sprint M14 (catalog-import real evidence follow-up) - re-runs the exact
// real ingestion+eligibility pipeline (runIngestionPipeline +
// evaluateEligibility, the same functions the real submit endpoint calls)
// for an EXISTING listing after new real evidence has been loaded into
// marketplace_evidence_records via load-marketplace-evidence.ts. Fixes
// the real, previously-disclosed gap: MarketplaceListing.trustState/
// evidenceId/etc are separate, manually-synced columns that don't update
// on their own when the evidence table changes.
//
// Usage: npx tsx scripts/resubmit-listing.ts <slug>
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { runIngestionPipeline } from "../services/marketplace/factory/ingestion";
import { evaluateEligibility } from "../services/marketplace/factory/eligibility";

async function main() {
  const slug = process.argv[2];
  if (!slug) throw new Error("Usage: npx tsx scripts/resubmit-listing.ts <slug>");

  const listing = await prisma.marketplaceListing.findUnique({ where: { slug } });
  if (!listing) throw new Error(`No listing found for slug ${slug}`);
  if (!listing.tradingSystemId || !listing.versionId) throw new Error("Listing has no tradingSystemId/versionId bound");

  const ingestion = await runIngestionPipeline({
    title: listing.title, description: listing.description, platformTag: listing.platformTag,
    tradingSystemId: listing.tradingSystemId, versionId: listing.versionId,
  });
  if (ingestion.failedAt) throw new Error(`Ingestion failed at ${ingestion.failedAt}: ${JSON.stringify(ingestion.stages)}`);

  const eligibility = evaluateEligibility({
    tradingSystemId: listing.tradingSystemId, versionId: listing.versionId,
    evidenceId: ingestion.evidenceId, validationId: ingestion.validationId,
    validationOverallStatus: ingestion.validationOverallStatus, riskAnalysisId: ingestion.riskAnalysisId,
    riskStatus: ingestion.riskStatus, trustState: ingestion.trustState,
    sellerId: listing.sellerId, requestingUserId: listing.sellerId,
  });

  const updated = await prisma.marketplaceListing.update({
    where: { id: listing.id },
    data: {
      evidenceId: ingestion.evidenceId, evidenceHash: ingestion.evidenceHash,
      validationId: ingestion.validationId, validationHash: ingestion.validationHash,
      riskAnalysisId: ingestion.riskAnalysisId, riskAnalysisHash: ingestion.riskAnalysisHash,
      trustState: ingestion.trustState, trustReasonCode: ingestion.trustReasonCode,
      trustExplanation: ingestion.trustExplanation ?? "", trustStatusId: ingestion.trustStatusId,
      lastEvidenceAt: ingestion.lastEvidenceAt ? new Date(ingestion.lastEvidenceAt) : null,
      // Publication state: keep already-PUBLISHED listings published (real
      // eligibility already granted for the M14 catalog-import batch via the
      // explicit user-directed override) - only upgrade DRAFT to READY if the
      // real gate is now satisfied. Never downgrade a live listing here.
      publicationState: listing.publicationState === "PUBLISHED" ? "PUBLISHED" : (eligibility.eligible ? "READY" : listing.publicationState),
    },
  });

  console.log(`${updated.title}: trustState=${updated.trustState} (${updated.trustReasonCode}) publicationState=${updated.publicationState}`);
  console.log(`eligibility: ${JSON.stringify(eligibility)}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
