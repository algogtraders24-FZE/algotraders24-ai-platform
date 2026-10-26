// scripts/apply-range-rider-trust.ts
// Applies the Trust State the real M2-M7 chain produced for Range Rider (already loaded with
// load-marketplace-evidence.ts) to the listing, using the same ingestion pipeline as every other listing.
// Unlike create-goldsniper-listing.ts it NEVER touches publicationState - a live listing stays live.
// Usage: npx tsx scripts/apply-range-rider-trust.ts
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { runIngestionPipeline } from "../services/marketplace/factory/ingestion";
import { evaluateEligibility } from "../services/marketplace/factory/eligibility";

const SLUG = "at24-range-rider-xau";

async function main() {
  const listing = await prisma.marketplaceListing.findFirst({ where: { slug: SLUG, deletedAt: null } });
  if (!listing?.tradingSystemId || !listing.versionId) throw new Error(`No listing / version for slug ${SLUG}`);

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
    },
  });
  console.log("slug:", updated.slug, "| publicationState (unchanged):", updated.publicationState, "| trustState:", updated.trustState, "|", updated.trustReasonCode);
  console.log("eligibility:", JSON.stringify(eligibility));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
