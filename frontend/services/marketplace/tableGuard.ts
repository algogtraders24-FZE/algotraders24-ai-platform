// services/marketplace/tableGuard.ts
// Sprint M8 - Shared guard for the fact that `marketplace_listings` is
// deliberately NOT migrated onto the live database this sprint (see
// M8_database_architecture_audit.md). Any query against it fails with
// Prisma P2021 ("table does not exist") until a separate, explicit
// go-ahead applies that migration. Used by both MarketplaceCatalogue
// (public reads) and the private marketplace API routes so build-time
// static generation and real requests degrade to "nothing exists yet"
// instead of a raw 500/build failure - while any OTHER error still
// propagates normally, so a real bug once the table exists is never masked.
//
// Deliberately NOT marked "server-only" (unlike MarketplaceCatalogue.ts):
// it's a generic Prisma-error utility (also used directly by the
// app/api/private/marketplace/* route handlers, which aren't Server-
// Component data-layer files), and this repo's own validate-*.ts
// convention needs to import and unit-test real logic directly - see
// scripts/validate-marketplace-platform.ts.
import { Prisma } from "@/lib/generated/prisma/client";

export function isTableMissingError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2021";
}

export async function withTableFallback<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isTableMissingError(err)) return fallback;
    throw err;
  }
}
