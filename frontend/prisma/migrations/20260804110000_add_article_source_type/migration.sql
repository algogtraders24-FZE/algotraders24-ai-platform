-- Sprint D2.3.S1 - Publishing Activation: sourceType field (ai/manual/
-- imported/research) for future extensibility. Hand-written, additive only,
-- same rationale as 20260804100000_add_article (no `prisma migrate dev`).

ALTER TABLE "articles" ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'manual';
