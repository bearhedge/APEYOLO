/**
 * Direct IBKR test script - bypasses all app code
 * Run with: npx tsx scripts/test-option-data.ts
 */

import { config } from 'dotenv';
config(); // Load .env file

import { createIbkrProvider, ensureIbkrReady } from '../server/broker/ibkr.js';

const STRIKE = 607;  // Change this to test different strikes
const RIGHT = 'C';    // 'C' for call, 'P' for put
const SYMBOL = 'SPY';

async function main() {
  console.log('='.repeat(60));
  console.log(`Testing IBKR option data for ${SYMBOL} ${STRIKE} ${RIGHT}`);
  console.log('='.repeat(60));

  // Step 1: Initialize IBKR
  console.log('\n[1] Initializing IBKR provider...');
  const provider = createIbkrProvider({ env: 'live' });

  console.log('\n[2] Ensuring IBKR is ready...');
  await ensureIbkrReady();
  console.log('✓ IBKR ready');

  // Step 2: Get account to verify connection
  console.log('\n[3] Testing account connection...');
  try {
    const account = await provider.getAccount();
    console.log(`✓ Account: ${account.accountNumber}`);
    console.log(`  Portfolio Value: $${account.portfolioValue?.toLocaleString()}`);
    console.log(`  Buying Power: $${account.buyingPower?.toLocaleString()}`);
  } catch (err: any) {
    console.error(`✗ Account fetch failed: ${err.message}`);
  }

  // Step 3: Get SPY price
  console.log('\n[4] Getting SPY price...');
  try {
    const spyData = await provider.getMarketData('SPY');
    console.log(`✓ SPY: price=${spyData.price}, bid=${spyData.bid}, ask=${spyData.ask}`);
  } catch (err: any) {
    console.error(`✗ SPY price failed: ${err.message}`);
  }

  // Step 4: Get option chain with the specific strike
  console.log(`\n[5] Getting option chain for ${SYMBOL}...`);
  console.log(`    Looking for strike ${STRIKE} ${RIGHT === 'C' ? 'CALL' : 'PUT'}`);

  try {
    // Get today's date in YYYYMMDD format
    const today = new Date();
    const expiration = today.toISOString().slice(0, 10).replace(/-/g, '');
    console.log(`    Target expiration: ${expiration}`);

    const chain = await provider.getOptionChain(SYMBOL, expiration);

    console.log(`\n✓ Option chain received:`);
    console.log(`  Underlying price: $${chain.underlyingPrice}`);
    console.log(`  Puts: ${chain.puts?.length || 0}`);
    console.log(`  Calls: ${chain.calls?.length || 0}`);

    // Find our specific strike
    const options = RIGHT === 'C' ? chain.calls : chain.puts;
    const targetOption = options?.find((o: any) => Math.abs(o.strike - STRIKE) < 0.5);

    if (targetOption) {
      console.log(`\n✓ Found ${STRIKE} ${RIGHT === 'C' ? 'CALL' : 'PUT'}:`);
      console.log(`  Bid: $${targetOption.bid}`);
      console.log(`  Ask: $${targetOption.ask}`);
      console.log(`  Last: $${targetOption.last || 'N/A'}`);
      console.log(`  Delta: ${targetOption.delta}`);
      console.log(`  IV: ${targetOption.iv || 'N/A'}`);
      console.log(`  OI: ${targetOption.openInterest || 'N/A'}`);
    } else {
      console.log(`\n✗ Strike ${STRIKE} not found in chain`);
      console.log(`  Available strikes (first 10):`);
      options?.slice(0, 10).forEach((o: any) => {
        console.log(`    ${o.strike}: bid=${o.bid}, ask=${o.ask}`);
      });
    }
  } catch (err: any) {
    console.error(`✗ Option chain failed: ${err.message}`);
    console.error(err.stack);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Test complete');
  console.log('='.repeat(60));

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
