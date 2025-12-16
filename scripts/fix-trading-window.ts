/**
 * One-time script to set trading window
 * Sets tradingWindowStart to 00:00 (midnight HKT)
 * Trading allowed AFTER this time
 *
 * Run with: npx tsx scripts/fix-trading-window.ts
 */

import { db } from '../server/db';
import { tradingMandates } from '../shared/schema';
import { eq } from 'drizzle-orm';

async function fixTradingWindow() {
  if (!db) {
    console.error('Database not available');
    process.exit(1);
  }

  console.log('Setting trading window to after 00:00 HKT...\n');

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
    console.log(`  Current: tradingWindowStart=${mandate.tradingWindowStart || 'null'}`);

    // Update trading window start time (midnight HKT)
    await db
      .update(tradingMandates)
      .set({
        tradingWindowStart: '00:00',
        tradingWindowEnd: null, // No end time - trading allowed all day after midnight
      })
      .where(eq(tradingMandates.id, mandate.id));

    console.log(`  Updated: tradingWindowStart=00:00 (midnight HKT)`);
    console.log(`  Effect: Trading only allowed after 12:00 AM HKT`);
    console.log('');
  }

  console.log('Done! Trading window set to after 00:00 HKT');
  process.exit(0);
}

fixTradingWindow().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
