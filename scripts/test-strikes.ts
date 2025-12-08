// test-strikes.ts - Direct IBKR strikes endpoint test
// Run: npx tsx test-strikes.ts

import 'dotenv/config';
import { createIbkrProvider, ensureIbkrReady, getOptionChainWithStrikes } from './server/broker/ibkr';

async function main() {
  console.log('\n=== IBKR STRIKES ENDPOINT TEST ===\n');

  try {
    // Step 1: Initialize IBKR
    console.log('Step 1: Creating IBKR provider...');
    const provider = createIbkrProvider({ env: 'paper' });
    console.log('Step 1b: Ensuring IBKR ready...');
    await ensureIbkrReady();
    console.log('✓ IBKR ready\n');

    // Step 2: Test the option chain endpoint
    console.log('Step 2: Calling getOptionChainWithStrikes("SPY")...');
    const result = await getOptionChainWithStrikes('SPY');

    console.log('\n=== RESULT ===');
    console.log('Underlying Price:', result.underlyingPrice);
    console.log('VIX:', result.vix);
    console.log('Expected Move:', result.expectedMove);
    console.log('Puts count:', result.puts?.length || 0);
    console.log('Calls count:', result.calls?.length || 0);

    console.log('\n=== DIAGNOSTICS ===');
    console.log(JSON.stringify(result.diagnostics, null, 2));

    if (result.puts.length > 0) {
      console.log('\n=== SAMPLE PUTS ===');
      console.log(JSON.stringify(result.puts.slice(0, 3), null, 2));
    }

    if (result.calls.length > 0) {
      console.log('\n=== SAMPLE CALLS ===');
      console.log(JSON.stringify(result.calls.slice(0, 3), null, 2));
    }

  } catch (err: any) {
    console.error('\n❌ ERROR:', err.message);
    console.error(err.stack);
  }

  process.exit(0);
}

main();
