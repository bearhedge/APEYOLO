/**
 * Run migration 0002 to create engine_runs table
 */
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://home@localhost:5432/options_data';

async function runMigration() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    // Check if engine_runs already exists
    const checkResult = await pool.query(`
      SELECT EXISTS(
        SELECT FROM information_schema.tables
        WHERE table_name = 'engine_runs'
      );
    `);

    if (checkResult.rows[0].exists) {
      console.log('engine_runs table already exists - migration already applied');
      return;
    }

    console.log('Creating engine_runs and related tables...');

    // Read the migration file
    const migrationPath = path.join(__dirname, '../drizzle/0002_productive_lightspeed.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    // Split by statement-breakpoint and execute each statement
    const statements = migrationSQL.split('--> statement-breakpoint');

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i].trim();
      if (stmt) {
        console.log(`Executing statement ${i + 1}/${statements.length}...`);
        try {
          await pool.query(stmt);
        } catch (err: any) {
          // Skip if column/table already exists
          if (err.code === '42701' || err.code === '42P07') {
            console.log(`  Skipped (already exists)`);
          } else {
            throw err;
          }
        }
      }
    }

    console.log('Migration completed successfully!');

  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
