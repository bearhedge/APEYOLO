/**
 * One-time script to fix mandate delta range
 * Updates the active mandate to use 0.10-0.20 delta range
 *
 * Run with: npx tsx scripts/fix-mandate-delta.ts
 */

import { db } from '../server/db';
import { tradingMandates } from '../shared/schema';
import { eq } from 'drizzle-orm';

async function fixMandateDelta() {
  if (!db) {
    console.error('Database not available');
    process.exit(1);
  }

  console.log('Fixing mandate delta range...\n');

  // Find active mandates
  const activeMandates = await db
    .select()
    .from(tradingMandates)
    .where(eq(tradingMandates.isActive, true));

  if (activeMandates.length === 0) {
    console.log('No active mandates found');
    process.exit(0);
  }

  console.log(`Found ${activeMandates.length} active mandate(s)\n`);

  for (const mandate of activeMandates) {
    console.log(`Mandate ${mandate.id}:`);
    console.log(`  Current: minDelta=${mandate.minDelta}, maxDelta=${mandate.maxDelta}`);

    // Update delta range
    await db
      .update(tradingMandates)
      .set({
        minDelta: '0.10',
        maxDelta: '0.20'
      })
      .where(eq(tradingMandates.id, mandate.id));

    console.log(`  Updated: minDelta=0.10, maxDelta=0.20`);
    console.log('');
  }

  console.log('Done! Mandate delta range updated to 0.10-0.20');
  process.exit(0);
}

fixMandateDelta().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
