-- Optional second-platform listing for a reward product (additive, nullable).
ALTER TABLE "reward_products" ADD COLUMN IF NOT EXISTS "mt4ListingId" TEXT;
