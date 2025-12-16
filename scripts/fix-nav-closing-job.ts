/**
 * One-time script to update nav-snapshot-closing job config
 * Adds skipMarketCheck: true so the job runs after market close (4:15 PM ET)
 *
 * Run with: DATABASE_URL="..." npx tsx scripts/fix-nav-closing-job.ts
 */

import { db } from '../server/db';
import { jobs } from '../shared/schema';
import { eq } from 'drizzle-orm';

async function fixNavClosingJob() {
  if (!db) {
    console.error('Database not available');
    process.exit(1);
  }

  console.log('Updating nav-snapshot-closing job config...\n');

  // Find the existing job
  const [existingJob] = await db
    .select()
    .from(jobs)
    .where(eq(jobs.id, 'nav-snapshot-closing'))
    .limit(1);

  if (!existingJob) {
    console.log('Job nav-snapshot-closing not found. It will be created with correct config on next server start.');
    process.exit(0);
  }

  console.log('Current config:', JSON.stringify(existingJob.config));

  // Update config to include skipMarketCheck
  const currentConfig = (existingJob.config as Record<string, any>) || {};
  const newConfig = {
    ...currentConfig,
    skipMarketCheck: true,
  };

  await db
    .update(jobs)
    .set({ config: newConfig })
    .where(eq(jobs.id, 'nav-snapshot-closing'));

  console.log('Updated config:', JSON.stringify(newConfig));
  console.log('\nDone! NAV Snapshot (Closing) will now run at 4:15 PM ET regardless of market status.');
  process.exit(0);
}

fixNavClosingJob().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
