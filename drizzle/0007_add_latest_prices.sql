-- Migration: Add latest_prices table for WebSocket price persistence
-- This ensures SPY/VIX prices survive server restarts

CREATE TABLE IF NOT EXISTS "latest_prices" (
  "symbol" TEXT PRIMARY KEY,
  "conid" INTEGER,
  "price" NUMERIC(12, 4) NOT NULL,
  "bid" NUMERIC(12, 4),
  "ask" NUMERIC(12, 4),
  "source" TEXT NOT NULL DEFAULT 'websocket',
  "updated_at" TIMESTAMP NOT NULL DEFAULT now()
);

-- Index for conid lookups
CREATE INDEX IF NOT EXISTS "latest_prices_conid_idx" ON "latest_prices" ("conid");

-- Seed with current known values (will be overwritten by WebSocket)
INSERT INTO "latest_prices" ("symbol", "conid", "price", "source") VALUES
  ('SPY', 756733, 689.23, 'manual'),
  ('VIX', 13455763, 16.00, 'manual')
ON CONFLICT ("symbol") DO NOTHING;
