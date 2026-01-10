import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema";

// Cloud SQL PostgreSQL connection
// In Cloud Run, uses Unix socket: /cloudsql/PROJECT:REGION:INSTANCE
// Locally, can use direct TCP connection

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.warn('[DB] DATABASE_URL not set - database features disabled');
}

// Create pool only if DATABASE_URL is configured
export const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL })
  : null;

// Export db instance (or null if not configured)
export const db = pool ? drizzle(pool, { schema }) : null;

// Helper to check if database is available
export function isDatabaseConfigured(): boolean {
  return db !== null;
}

/**
 * Run essential migrations on startup if tables don't exist
 */
export async function runEssentialMigrations(): Promise<void> {
  if (!pool) return;

  try {
    const client = await pool.connect();

    // Check if engine_runs exists
    const check = await client.query(`
      SELECT EXISTS(SELECT FROM information_schema.tables WHERE table_name = 'engine_runs') as exists;
    `);

    if (!check.rows[0].exists) {
      console.log('[DB] Creating engine_runs and related tables...');

      // Create engine_runs table
      await client.query(`
        CREATE TABLE IF NOT EXISTS "engine_runs" (
          "id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          "user_id" varchar(36),
          "symbol" text NOT NULL,
          "direction" text NOT NULL,
          "expiration_mode" text,
          "original_put_strike" double precision,
          "original_call_strike" double precision,
          "original_put_delta" double precision,
          "original_call_delta" double precision,
          "final_put_strike" double precision,
          "final_call_strike" double precision,
          "adjustment_count" integer DEFAULT 0,
          "underlying_price" double precision,
          "vix" double precision,
          "indicators" jsonb,
          "engine_output" jsonb,
          "trade_id" varchar(36),
          "realized_pnl" double precision,
          "exit_reason" text,
          "was_winner" boolean,
          "created_at" timestamp DEFAULT now() NOT NULL,
          "closed_at" timestamp
        );
      `);

      // Create direction_predictions table
      await client.query(`
        CREATE TABLE IF NOT EXISTS "direction_predictions" (
          "id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          "engine_run_id" varchar(36),
          "indicator_signal" text,
          "indicator_confidence" double precision,
          "indicator_reasoning" jsonb,
          "ai_suggestion" text,
          "ai_confidence" double precision,
          "user_choice" text NOT NULL,
          "agreed_with_ai" boolean,
          "agreed_with_indicators" boolean,
          "was_override" boolean,
          "override_was_correct" boolean,
          "pnl" double precision,
          "was_correct" boolean,
          "created_at" timestamp DEFAULT now() NOT NULL
        );
      `);

      // Create indicator_snapshots table
      await client.query(`
        CREATE TABLE IF NOT EXISTS "indicator_snapshots" (
          "id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          "symbol" text NOT NULL,
          "price" double precision NOT NULL,
          "open" double precision,
          "high" double precision,
          "low" double precision,
          "volume" double precision,
          "sma_20" double precision,
          "sma_50" double precision,
          "ema_9" double precision,
          "ema_21" double precision,
          "rsi_14" double precision,
          "macd" double precision,
          "macd_signal" double precision,
          "macd_histogram" double precision,
          "atr_14" double precision,
          "bollinger_upper" double precision,
          "bollinger_lower" double precision,
          "vix" double precision,
          "trend_direction" text,
          "momentum_signal" text,
          "volatility_regime" text,
          "created_at" timestamp DEFAULT now() NOT NULL
        );
      `);

      // Create indexes
      await client.query(`CREATE INDEX IF NOT EXISTS "engine_runs_user_id_idx" ON "engine_runs" USING btree ("user_id");`);
      await client.query(`CREATE INDEX IF NOT EXISTS "engine_runs_created_at_idx" ON "engine_runs" USING btree ("created_at");`);
      await client.query(`CREATE INDEX IF NOT EXISTS "direction_predictions_engine_run_idx" ON "direction_predictions" USING btree ("engine_run_id");`);
      await client.query(`CREATE INDEX IF NOT EXISTS "indicator_snapshots_symbol_idx" ON "indicator_snapshots" USING btree ("symbol");`);

      console.log('[DB] ✅ engine_runs and related tables created successfully');
    } else {
      console.log('[DB] engine_runs table exists');
    }

    client.release();
  } catch (err: any) {
    console.error('[DB] Migration error:', err.message);
  }
}

// Test database connectivity on startup
export async function testDatabaseConnection(): Promise<boolean> {
  if (!pool) {
    console.warn('[DB] No pool configured - skipping connection test');
    return false;
  }

  try {
    console.log('[DB] Testing database connection...');
    console.log('[DB] DATABASE_URL starts with:', DATABASE_URL?.substring(0, 50) + '...');

    // Run essential migrations first
    await runEssentialMigrations();

    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as now, current_database() as db');

    console.log('[DB] ✅ Database connection successful!');
    console.log('[DB] Server time:', result.rows[0].now);
    console.log('[DB] Database:', result.rows[0].db);

    // Check if market_data table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'market_data'
      ) as exists
    `);
    console.log('[DB] market_data table exists:', tableCheck.rows[0].exists);

    if (!tableCheck.rows[0].exists) {
      console.error('[DB] ⚠️ market_data table does NOT exist! Need to run migrations.');
    }

    // Check if gen_random_uuid() works (requires pgcrypto extension)
    try {
      const uuidTest = await client.query('SELECT gen_random_uuid() as uuid');
      console.log('[DB] gen_random_uuid() works:', uuidTest.rows[0].uuid);
    } catch (uuidError: any) {
      console.error('[DB] ⚠️ gen_random_uuid() FAILED:', uuidError.message);
      console.error('[DB] Need to run: CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    }

    // Try a test INSERT
    try {
      const testInsert = await client.query(`
        INSERT INTO market_data (symbol, timestamp, open, high, low, close, volume, interval, source)
        VALUES ('TEST', NOW(), '100.0', '101.0', '99.0', '100.5', 1000, 'test', 'test')
        RETURNING id
      `);
      console.log('[DB] ✅ Test INSERT succeeded, id:', testInsert.rows[0].id);

      // Clean up
      await client.query(`DELETE FROM market_data WHERE symbol = 'TEST'`);
      console.log('[DB] Test record cleaned up');
    } catch (insertError: any) {
      console.error('[DB] ⚠️ Test INSERT FAILED:', insertError.message);
      console.error('[DB] Error code:', insertError.code);
      console.error('[DB] Error detail:', insertError.detail);
    }

    client.release();
    return true;
  } catch (error: any) {
    console.error('[DB] ❌ Database connection FAILED!');
    console.error('[DB] Error:', error.message);
    console.error('[DB] Code:', error.code);
    console.error('[DB] Errno:', error.errno);
    console.error('[DB] Syscall:', error.syscall);
    console.error('[DB] Address:', error.address);
    console.error('[DB] Full error:', JSON.stringify({
      message: error.message,
      code: error.code,
      errno: error.errno,
      syscall: error.syscall,
      address: error.address,
      cause: error.cause?.message,
    }));
    return false;
  }
}
