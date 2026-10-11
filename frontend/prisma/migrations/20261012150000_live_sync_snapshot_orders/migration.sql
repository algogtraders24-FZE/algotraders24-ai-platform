-- Additive: pending orders sent by EA v1.2+ (nullable; older snapshots have none).
ALTER TABLE "live_sync_snapshots" ADD COLUMN "orders" JSONB;
