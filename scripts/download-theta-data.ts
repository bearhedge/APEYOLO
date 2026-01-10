#!/usr/bin/env npx tsx
/**
 * CLI script to download Theta historical options data
 *
 * Usage:
 *   npx tsx scripts/download-theta-data.ts
 *   npx tsx scripts/download-theta-data.ts --start 20230101 --end 20231231
 *   npx tsx scripts/download-theta-data.ts --month 202312
 */

import { downloadAll, isThetaAvailable } from '../server/services/theta/bulkDownloader';
import { getTradingDays } from '../server/services/theta/thetaClient';

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let symbol = 'SPY';
  let startDate = '20221201';
  let endDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let interval: '1m' | '5m' = '1m';
  let includeGreeks = true;
  let includeQuotes = true;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--symbol' && args[i + 1]) {
      symbol = args[i + 1].toUpperCase();
      i++;
    } else if (args[i] === '--start' && args[i + 1]) {
      startDate = args[i + 1];
      i++;
    } else if (args[i] === '--end' && args[i + 1]) {
      endDate = args[i + 1];
      i++;
    } else if (args[i] === '--month' && args[i + 1]) {
      const month = args[i + 1];
      startDate = `${month}01`;
      endDate = `${month}31`;
      i++;
    } else if (args[i] === '--interval' && args[i + 1]) {
      interval = args[i + 1] as '1m' | '5m';
      i++;
    } else if (args[i] === '--no-greeks') {
      includeGreeks = false;
    } else if (args[i] === '--no-quotes') {
      includeQuotes = false;
    } else if (args[i] === '--help') {
      console.log(`
Theta Data Downloader
=====================

Downloads SPY 0DTE options data from Theta Terminal.

Usage:
  npx tsx scripts/download-theta-data.ts [options]

Options:
  --start YYYYMMDD   Start date (default: 20221201)
  --end YYYYMMDD     End date (default: today)
  --month YYYYMM     Download single month
  --interval 1m|5m   Bar interval (default: 1m)
  --no-greeks        Skip Greeks data
  --no-quotes        Skip quote data
  --help             Show this help

Examples:
  npx tsx scripts/download-theta-data.ts
  npx tsx scripts/download-theta-data.ts --start 20230101 --end 20231231
  npx tsx scripts/download-theta-data.ts --month 202312
  npx tsx scripts/download-theta-data.ts --interval 5m --no-quotes

Data downloaded per day:
  - OHLC bars (1-minute): ~113K records
  - Greeks first_order: ~219K records (delta, theta, vega, rho, IV)
  - Quotes: ~219K records (bid/ask with size)
  - Open Interest: ~560 records
  - Greeks EOD: ~560 records (all 44 Greeks fields)

Storage: ~3.8 MB per day compressed (~3 GB for full history)
`);
      process.exit(0);
    }
  }

  console.log('='.repeat(60));
  console.log('Theta Historical Data Downloader');
  console.log('='.repeat(60));
  console.log(`Symbol: ${symbol}`);
  console.log(`Start: ${startDate}`);
  console.log(`End:   ${endDate}`);
  console.log(`Interval: ${interval}`);
  console.log(`Greeks: ${includeGreeks ? 'Yes' : 'No'}`);
  console.log(`Quotes: ${includeQuotes ? 'Yes' : 'No'}`);
  console.log('');

  // Calculate estimates
  const tradingDays = getTradingDays(startDate, endDate);
  const estimatedSizeGB = (tradingDays.length * 3.8) / 1024;
  const estimatedTimeHours = (tradingDays.length * 10) / 3600;

  console.log(`Trading days: ${tradingDays.length}`);
  console.log(`Estimated size: ${estimatedSizeGB.toFixed(1)} GB`);
  console.log(`Estimated time: ${estimatedTimeHours.toFixed(1)} hours`);
  console.log('');

  // Check if Theta Terminal is running
  console.log('Checking Theta Terminal...');
  const available = await isThetaAvailable();
  if (!available) {
    console.error('ERROR: Theta Terminal is not running!');
    console.error('');
    console.error('Start it with:');
    console.error('  java -jar ThetaTerminalv3.jar --config config/theta/config.toml --creds-file config/theta/creds.txt');
    console.error('');
    process.exit(1);
  }

  console.log('Theta Terminal: Connected');
  console.log('');

  // Start download
  const startTime = Date.now();
  const progress = await downloadAll({
    symbol,
    startDate,
    endDate,
    interval,
    includeGreeks,
    includeQuotes,
    includeTrades: false,
  });

  const elapsed = (Date.now() - startTime) / 1000 / 60;
  console.log('');
  console.log('='.repeat(60));
  console.log('Download Summary');
  console.log('='.repeat(60));
  console.log(`Completed: ${progress.stats.completedCount} days`);
  console.log(`Failed: ${progress.stats.failedCount} days`);
  console.log(`Total size: ${(progress.stats.totalBytes / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Time: ${elapsed.toFixed(1)} minutes`);

  if (progress.failedDays.length > 0) {
    console.log('');
    console.log('Failed days:');
    progress.failedDays.forEach(f => console.log(`  ${f.date}: ${f.error}`));
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
