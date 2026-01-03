-- Migration: Add user_settings table for RLHF auto-run feature
-- This table stores user preferences including the auto-run toggle

CREATE TABLE IF NOT EXISTS "user_settings" (
  "id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" varchar(36) NOT NULL REFERENCES "users"("id") ON DELETE CASCADE UNIQUE,
  "auto_run_enabled" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_settings_user_id_idx" ON "user_settings" ("user_id");
