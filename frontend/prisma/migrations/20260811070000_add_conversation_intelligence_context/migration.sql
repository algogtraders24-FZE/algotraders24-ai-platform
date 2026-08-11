-- Sprint D2.6.7 - Conversation Continuity & Verified Market Context Memory.
-- Hand-written (not `prisma migrate dev`, per this repo's established
-- convention). Purely additive: one new nullable column, zero changes to
-- any existing column, type, or constraint.

ALTER TABLE "Conversation"
  ADD COLUMN "intelligenceContext" JSONB;
