-- Calibration scoreboard: mark forecasts whose window contains a scheduled US release (band widened). Additive; default false keeps old rows as normal windows.
ALTER TABLE "range_forecasts" ADD COLUMN IF NOT EXISTS "event12" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "range_forecasts" ADD COLUMN IF NOT EXISTS "event24" BOOLEAN NOT NULL DEFAULT false;
