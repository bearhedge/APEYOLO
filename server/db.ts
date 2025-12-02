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

// Test database connectivity on startup
export async function testDatabaseConnection(): Promise<boolean> {
  if (!pool) {
    console.warn('[DB] No pool configured - skipping connection test');
    return false;
  }

  try {
    console.log('[DB] Testing database connection...');
    console.log('[DB] DATABASE_URL starts with:', DATABASE_URL?.substring(0, 50) + '...');

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
