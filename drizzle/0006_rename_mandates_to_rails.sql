-- Rename "Mandate" to "DeFi Rails"
-- This migration renames tables and columns from mandate terminology to rails terminology

-- Step 1: Rename the main tables
ALTER TABLE "trading_mandates" RENAME TO "defi_rails";
ALTER TABLE "mandate_violations" RENAME TO "rail_violations";
ALTER TABLE "mandate_events" RENAME TO "rail_events";

-- Step 2: Rename foreign key columns in rail_violations
ALTER TABLE "rail_violations" RENAME COLUMN "mandate_id" TO "rail_id";

-- Step 3: Rename foreign key columns in rail_events
ALTER TABLE "rail_events" RENAME COLUMN "mandate_id" TO "rail_id";
ALTER TABLE "rail_events" RENAME COLUMN "previous_mandate_id" TO "previous_rail_id";

-- Step 4: Rename indexes (PostgreSQL requires dropping and recreating with new names)
-- Drop old indexes
DROP INDEX IF EXISTS "trading_mandates_user_id_idx";
DROP INDEX IF EXISTS "trading_mandates_active_idx";
DROP INDEX IF EXISTS "mandate_violations_user_id_idx";
DROP INDEX IF EXISTS "mandate_violations_mandate_id_idx";
DROP INDEX IF EXISTS "mandate_violations_created_at_idx";
DROP INDEX IF EXISTS "mandate_events_user_id_idx";
DROP INDEX IF EXISTS "mandate_events_mandate_id_idx";
DROP INDEX IF EXISTS "mandate_events_type_idx";
DROP INDEX IF EXISTS "mandate_events_created_at_idx";

-- Create new indexes with rails naming
CREATE INDEX "defi_rails_user_id_idx" ON "defi_rails" ("user_id");
CREATE INDEX "defi_rails_active_idx" ON "defi_rails" ("user_id", "is_active");
CREATE INDEX "rail_violations_user_id_idx" ON "rail_violations" ("user_id");
CREATE INDEX "rail_violations_rail_id_idx" ON "rail_violations" ("rail_id");
CREATE INDEX "rail_violations_created_at_idx" ON "rail_violations" ("created_at");
CREATE INDEX "rail_events_user_id_idx" ON "rail_events" ("user_id");
CREATE INDEX "rail_events_rail_id_idx" ON "rail_events" ("rail_id");
CREATE INDEX "rail_events_type_idx" ON "rail_events" ("event_type");
CREATE INDEX "rail_events_created_at_idx" ON "rail_events" ("created_at");
