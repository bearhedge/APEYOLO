/**
 * Simple strike test - ATM ± 5, Dec 8th expiration
 * Run with: npx tsx scripts/test-simple-strikes.ts
 */

import { config } from 'dotenv';
config();

import { createIbkrProvider, ensureIbkrReady } from '../server/broker/ibkr.js';

const SYMBOL = 'SPY';
const EXPIRATION = '20251208'; // Dec 8th, 2025
const RANGE = 5; // ± 5 strikes from ATM

async function main() {
  console.log('='.repeat(60));
  console.log(`Simple Strike Test: ${SYMBOL} ATM ± ${RANGE}`);
  console.log(`Expiration: Dec 8, 2025`);
  console.log('='.repeat(60));

  const provider = createIbkrProvider({ env: 'live' });

  console.log('\n[1] Connecting to IBKR...');
  await ensureIbkrReady();
  console.log('✓ Connected');

  // Get SPY price
  console.log('\n[2] Getting SPY price...');
  const spyData = await provider.getMarketData(SYMBOL);
  const spyPrice = spyData.price || spyData.last || 686; // fallback
  console.log(`✓ SPY Price: $${spyPrice}`);

  // Calculate ATM strike (round to nearest dollar)
  const atmStrike = Math.round(spyPrice);
  console.log(`✓ ATM Strike: $${atmStrike}`);

  // Generate strikes: ATM-5 to ATM+5
  const strikes: number[] = [];
  for (let i = -RANGE; i <= RANGE; i++) {
    strikes.push(atmStrike + i);
  }
  console.log(`✓ Strikes to fetch: ${strikes.join(', ')}`);

  // Get option chain
  console.log(`\n[3] Fetching option chain for ${EXPIRATION}...`);
  const startTime = Date.now();

  try {
    const chain = await provider.getOptionChain(SYMBOL, EXPIRATION);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`✓ Fetched in ${elapsed}s`);
    console.log(`  Underlying: $${chain.underlyingPrice}`);
    console.log(`  Total Puts: ${chain.puts?.length || 0}`);
    console.log(`  Total Calls: ${chain.calls?.length || 0}`);

    // Filter to our strikes
    console.log('\n' + '='.repeat(60));
    console.log('PUTS (ATM - 5 to ATM + 5)');
    console.log('='.repeat(60));
    console.log('Strike  | Bid      | Ask      | Last     | Delta    | IV');
    console.log('-'.repeat(60));

    for (const strike of strikes) {
      const put = chain.puts?.find((p: any) => Math.abs(p.strike - strike) < 0.5);
      if (put) {
        console.log(
          `$${strike.toString().padEnd(5)} | ` +
          `$${(put.bid ?? 0).toFixed(2).padEnd(7)} | ` +
          `$${(put.ask ?? 0).toFixed(2).padEnd(7)} | ` +
          `$${(put.last ?? 0).toFixed(2).padEnd(7)} | ` +
          `${(put.delta ?? 0).toFixed(3).padEnd(8)} | ` +
          `${put.iv ? (put.iv * 100).toFixed(1) + '%' : 'N/A'}`
        );
      } else {
        console.log(`$${strike.toString().padEnd(5)} | NOT FOUND`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('CALLS (ATM - 5 to ATM + 5)');
    console.log('='.repeat(60));
    console.log('Strike  | Bid      | Ask      | Last     | Delta    | IV');
    console.log('-'.repeat(60));

    for (const strike of strikes) {
      const call = chain.calls?.find((c: any) => Math.abs(c.strike - strike) < 0.5);
      if (call) {
        console.log(
          `$${strike.toString().padEnd(5)} | ` +
          `$${(call.bid ?? 0).toFixed(2).padEnd(7)} | ` +
          `$${(call.ask ?? 0).toFixed(2).padEnd(7)} | ` +
          `$${(call.last ?? 0).toFixed(2).padEnd(7)} | ` +
          `${(call.delta ?? 0).toFixed(3).padEnd(8)} | ` +
          `${call.iv ? (call.iv * 100).toFixed(1) + '%' : 'N/A'}`
        );
      } else {
        console.log(`$${strike.toString().padEnd(5)} | NOT FOUND`);
      }
    }

  } catch (err: any) {
    console.error(`✗ Error: ${err.message}`);
  }

  console.log('\n' + '='.repeat(60));
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
