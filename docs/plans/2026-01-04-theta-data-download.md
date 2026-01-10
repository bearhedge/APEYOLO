# SPY 0DTE Options Data Download Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Download complete SPY 0DTE options data from Theta (Dec 2022 - present) for RLHF model training.

**Architecture:** Batch downloader that fetches daily options data (OHLC, quotes, open interest) within a dynamic strike range based on daily high/low. Data stored as compressed JSON files organized by month. Progress tracking enables resumable downloads.

**Tech Stack:** TypeScript, Theta Data REST API v3, Node.js fs/zlib, local file storage

---

## Data Specifications (UPDATED from API Audit 2026-01-04)

### Available with STANDARD subscription:

**History Endpoints (v3 API format: `/v3/option/history/...`):**

| Endpoint | Fields | Use Case |
|----------|--------|----------|
| `ohlc` | open, high, low, close, volume, vwap, count, timestamp | Price action analysis |
| `quote` | bid, ask, bid_size, ask_size, bid/ask_exchange, bid/ask_condition | Spread analysis, liquidity |
| `trade` | price, size, condition, exchange, sequence, ext_conditions | Individual trade analysis |
| `trade_quote` | All trade + quote fields combined | Complete trade context |
| `open_interest` | open_interest, timestamp | Position sizing, OI analysis |
| `eod` | OHLC + quote + volume + count + timestamps | End of day summary |
| `greeks/first_order` | delta, theta, vega, rho, IV, epsilon, lambda, underlying_price | Core Greeks for trading |
| `greeks/eod` | ALL Greeks (44 fields): delta, gamma, theta, vega, rho, IV, charm, vanna, vomma, speed, color, zomma, vera, veta, ultima, dual_delta, dual_gamma, d1, d2, epsilon, lambda + OHLC + volume | Comprehensive EOD Greeks |

**NOT available (requires PROFESSIONAL):**
- `greeks/second_order` - Second-order Greeks intraday
- `greeks/third_order` - Third-order Greeks intraday
- `greeks/all` - All Greeks intraday
- `trade_greeks/*` - Greeks at trade time

### Data Volume (1-minute bars, all strikes, per day):

| Data Type | Size/Day | Notes |
|-----------|----------|-------|
| OHLC | 9.3 MB | ~40K records |
| Greeks first_order | 33.9 MB | ~40K records with 17 fields |
| Quote | 18.4 MB | ~40K records with 13 fields |
| Trade | 60.3 MB | Individual trades (tick data aggregated to 1m) |
| Open Interest | 35 KB | One snapshot per strike |
| EOD | 78 KB | One record per strike |
| Greeks EOD | 172 KB | All 44 Greeks fields |

**Recommended Download (OHLC + Greeks + Quote + OI + EOD):**
- Per day: ~62 MB raw JSON
- 520 trading days (Dec 2022 - Jan 2026): ~32 GB uncompressed
- With gzip (~6x compression): **~5.3 GB compressed**

**Maximum Download (all data including trade):**
- Per day: ~122 MB raw JSON
- 520 trading days: ~63.4 GB uncompressed
- With gzip: **~10.6 GB compressed**

### Strike Range Logic:
- Download ALL strikes available (no filtering during download)
- Filter during training based on ATM ± delta threshold
- This ensures we have data for any strategy

---

## Phase 1: Download Infrastructure

### Task 1: Create Data Directory Structure

**Files:**
- Create: `data/theta/` directory structure

**Step 1: Create directories**

```bash
mkdir -p data/theta/ohlc
mkdir -p data/theta/quotes
mkdir -p data/theta/open_interest
mkdir -p data/theta/metadata
```

**Step 2: Add to .gitignore**

Add to `.gitignore`:
```
# Theta historical data (too large for git)
data/theta/
```

**Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: add theta data directory to gitignore"
```

---

### Task 2: Create Download Progress Tracker

**Files:**
- Create: `/Users/home/Desktop/APE YOLO/APE-YOLO/server/services/theta/downloadTracker.ts`

**Step 1: Write the tracker module**

```typescript
/**
 * Tracks download progress for resumable batch downloads.
 * Stores state in a JSON file so downloads can resume after interruption.
 */

import * as fs from 'fs';
import * as path from 'path';

const PROGRESS_FILE = 'data/theta/metadata/download_progress.json';

export interface DownloadProgress {
  startDate: string;
  endDate: string;
  currentMonth: string;
  completedDays: string[];
  failedDays: { date: string; error: string }[];
  lastUpdated: string;
  stats: {
    totalDays: number;
    completedCount: number;
    failedCount: number;
    totalBytes: number;
  };
}

export function loadProgress(): DownloadProgress | null {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      const data = fs.readFileSync(PROGRESS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('[DownloadTracker] Error loading progress:', error);
  }
  return null;
}

export function saveProgress(progress: DownloadProgress): void {
  const dir = path.dirname(PROGRESS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  progress.lastUpdated = new Date().toISOString();
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

export function initProgress(startDate: string, endDate: string): DownloadProgress {
  return {
    startDate,
    endDate,
    currentMonth: startDate.slice(0, 6),
    completedDays: [],
    failedDays: [],
    lastUpdated: new Date().toISOString(),
    stats: {
      totalDays: 0,
      completedCount: 0,
      failedCount: 0,
      totalBytes: 0,
    },
  };
}

export function markDayCompleted(progress: DownloadProgress, date: string, bytes: number): void {
  if (!progress.completedDays.includes(date)) {
    progress.completedDays.push(date);
    progress.stats.completedCount++;
    progress.stats.totalBytes += bytes;
  }
  saveProgress(progress);
}

export function markDayFailed(progress: DownloadProgress, date: string, error: string): void {
  progress.failedDays.push({ date, error });
  progress.stats.failedCount++;
  saveProgress(progress);
}

export function isDayCompleted(progress: DownloadProgress, date: string): boolean {
  return progress.completedDays.includes(date);
}
```

**Step 2: Verify syntax**

Run: `cd "/Users/home/Desktop/APE YOLO/APE-YOLO" && npx tsc --noEmit server/services/theta/downloadTracker.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add server/services/theta/downloadTracker.ts
git commit -m "feat: add download progress tracker for resumable downloads"
```

---

### Task 3: Create Bulk Data Downloader

**Files:**
- Create: `/Users/home/Desktop/APE YOLO/APE-YOLO/server/services/theta/bulkDownloader.ts`

**Step 1: Write the bulk downloader**

```typescript
/**
 * Bulk Downloader for Theta Historical Options Data
 *
 * Downloads SPY 0DTE options data organized by month.
 * Supports resumable downloads and rate limiting.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';
import {
  loadProgress,
  saveProgress,
  initProgress,
  markDayCompleted,
  markDayFailed,
  isDayCompleted,
  type DownloadProgress,
} from './downloadTracker';
import { getTradingDays } from './thetaClient';

const gzip = promisify(zlib.gzip);
const THETA_BASE_URL = process.env.THETA_BASE_URL || 'http://localhost:25503';
const DATA_DIR = 'data/theta';

// Rate limiting: Theta allows 4 concurrent requests
const MAX_CONCURRENT = 4;
const DELAY_BETWEEN_DAYS = 500; // ms

interface DownloadConfig {
  symbol: string;
  startDate: string; // YYYYMMDD
  endDate: string; // YYYYMMDD
  interval: '1m' | '5m';
  strikeRangePercent: number; // e.g., 2 for ±2%
}

interface DayData {
  date: string;
  ohlc: unknown[];
  quotes: unknown[];
  openInterest: unknown[];
  metadata: {
    symbol: string;
    expiration: string;
    strikeRange: { min: number; max: number };
    recordCounts: { ohlc: number; quotes: number; oi: number };
    downloadedAt: string;
  };
}

/**
 * Fetch OHLC data for all strikes on a given day
 */
async function fetchDayOHLC(
  symbol: string,
  date: string,
  interval: string
): Promise<{ data: unknown[]; strikes: number[] }> {
  const url = `${THETA_BASE_URL}/v3/option/history/ohlc?symbol=${symbol}&expiration=${date}&date=${date}&strike=*&right=both&interval=${interval}&format=json`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`OHLC fetch failed: ${await response.text()}`);
  }

  const data = await response.json();
  const strikes = [...new Set(data.strike || [])].map(Number);

  return { data, strikes };
}

/**
 * Fetch quote data for all strikes on a given day
 */
async function fetchDayQuotes(
  symbol: string,
  date: string,
  interval: string
): Promise<unknown[]> {
  const url = `${THETA_BASE_URL}/v3/option/history/quote?symbol=${symbol}&expiration=${date}&date=${date}&strike=*&right=both&interval=${interval}&format=json`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Quote fetch failed: ${await response.text()}`);
  }

  return response.json();
}

/**
 * Fetch open interest data for a given day
 */
async function fetchDayOpenInterest(
  symbol: string,
  date: string
): Promise<unknown[]> {
  const url = `${THETA_BASE_URL}/v3/option/history/open_interest?symbol=${symbol}&expiration=${date}&date=${date}&strike=*&right=both&format=json`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`OI fetch failed: ${await response.text()}`);
  }

  return response.json();
}

/**
 * Download all data for a single day
 */
async function downloadDay(
  symbol: string,
  date: string,
  interval: string
): Promise<DayData> {
  console.log(`[BulkDownload] Fetching ${date}...`);

  // Fetch all data types in parallel
  const [ohlcResult, quotes, openInterest] = await Promise.all([
    fetchDayOHLC(symbol, date, interval),
    fetchDayQuotes(symbol, date, interval),
    fetchDayOpenInterest(symbol, date),
  ]);

  const strikes = ohlcResult.strikes.sort((a, b) => a - b);

  return {
    date,
    ohlc: ohlcResult.data,
    quotes,
    openInterest,
    metadata: {
      symbol,
      expiration: date,
      strikeRange: { min: strikes[0], max: strikes[strikes.length - 1] },
      recordCounts: {
        ohlc: (ohlcResult.data as any).timestamp?.length || 0,
        quotes: (quotes as any).timestamp?.length || 0,
        oi: (openInterest as any).strike?.length || 0,
      },
      downloadedAt: new Date().toISOString(),
    },
  };
}

/**
 * Save day data to compressed JSON file
 */
async function saveDayData(data: DayData): Promise<number> {
  const month = data.date.slice(0, 6);
  const dir = path.join(DATA_DIR, 'raw', month);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filePath = path.join(dir, `${data.date}.json.gz`);
  const jsonData = JSON.stringify(data);
  const compressed = await gzip(jsonData);

  fs.writeFileSync(filePath, compressed);

  return compressed.length;
}

/**
 * Download data for a month
 */
async function downloadMonth(
  config: DownloadConfig,
  month: string,
  progress: DownloadProgress
): Promise<void> {
  const monthStart = `${month}01`;
  const monthEnd = `${month}31`;

  // Get trading days in this month within the overall range
  const startDate = Math.max(parseInt(config.startDate), parseInt(monthStart)).toString();
  const endDate = Math.min(parseInt(config.endDate), parseInt(monthEnd)).toString();

  const tradingDays = getTradingDays(startDate, endDate);

  console.log(`[BulkDownload] Month ${month}: ${tradingDays.length} trading days`);

  for (const date of tradingDays) {
    // Skip if already completed
    if (isDayCompleted(progress, date)) {
      console.log(`[BulkDownload] Skipping ${date} (already completed)`);
      continue;
    }

    try {
      const dayData = await downloadDay(config.symbol, date, config.interval);
      const bytes = await saveDayData(dayData);
      markDayCompleted(progress, date, bytes);

      console.log(
        `[BulkDownload] Saved ${date}: ${dayData.metadata.recordCounts.ohlc} OHLC, ` +
        `${dayData.metadata.recordCounts.quotes} quotes, ${dayData.metadata.recordCounts.oi} OI ` +
        `(${(bytes / 1024).toFixed(1)} KB)`
      );

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_DAYS));
    } catch (error: any) {
      console.error(`[BulkDownload] Failed ${date}:`, error.message);
      markDayFailed(progress, date, error.message);
    }
  }
}

/**
 * Get all months between two dates
 */
function getMonthsBetween(startDate: string, endDate: string): string[] {
  const months: string[] = [];
  const start = new Date(
    parseInt(startDate.slice(0, 4)),
    parseInt(startDate.slice(4, 6)) - 1,
    1
  );
  const end = new Date(
    parseInt(endDate.slice(0, 4)),
    parseInt(endDate.slice(4, 6)) - 1,
    1
  );

  for (let d = new Date(start); d <= end; d.setMonth(d.getMonth() + 1)) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    months.push(`${year}${month}`);
  }

  return months;
}

/**
 * Main download function - downloads all data for date range
 */
export async function downloadAll(config: DownloadConfig): Promise<DownloadProgress> {
  console.log(`[BulkDownload] Starting download: ${config.startDate} to ${config.endDate}`);

  // Load or initialize progress
  let progress = loadProgress();
  if (!progress || progress.startDate !== config.startDate || progress.endDate !== config.endDate) {
    progress = initProgress(config.startDate, config.endDate);
  }

  const months = getMonthsBetween(config.startDate, config.endDate);
  progress.stats.totalDays = getTradingDays(config.startDate, config.endDate).length;
  saveProgress(progress);

  console.log(`[BulkDownload] ${months.length} months, ~${progress.stats.totalDays} trading days`);

  for (const month of months) {
    console.log(`\n[BulkDownload] === Processing ${month} ===`);
    progress.currentMonth = month;
    saveProgress(progress);

    await downloadMonth(config, month, progress);
  }

  console.log(`\n[BulkDownload] === Complete ===`);
  console.log(`Completed: ${progress.stats.completedCount}/${progress.stats.totalDays}`);
  console.log(`Failed: ${progress.stats.failedCount}`);
  console.log(`Total size: ${(progress.stats.totalBytes / 1024 / 1024).toFixed(1)} MB`);

  return progress;
}

/**
 * CLI entry point
 */
export async function runDownload(): Promise<void> {
  const config: DownloadConfig = {
    symbol: 'SPY',
    startDate: '20221201',
    endDate: '20260104',
    interval: '1m',
    strikeRangePercent: 2,
  };

  await downloadAll(config);
}
```

**Step 2: Verify syntax**

Run: `cd "/Users/home/Desktop/APE YOLO/APE-YOLO" && npx tsc --noEmit server/services/theta/bulkDownloader.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add server/services/theta/bulkDownloader.ts
git commit -m "feat: add bulk downloader for Theta historical data"
```

---

### Task 4: Create Download CLI Script

**Files:**
- Create: `/Users/home/Desktop/APE YOLO/APE-YOLO/scripts/download-theta-data.ts`

**Step 1: Write the CLI script**

```typescript
#!/usr/bin/env npx tsx
/**
 * CLI script to download Theta historical options data
 *
 * Usage:
 *   npx tsx scripts/download-theta-data.ts
 *   npx tsx scripts/download-theta-data.ts --start 20230101 --end 20231231
 *   npx tsx scripts/download-theta-data.ts --month 202312
 */

import { downloadAll } from '../server/services/theta/bulkDownloader';
import { isThetaAvailable } from '../server/services/theta/thetaClient';

async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let startDate = '20221201';
  let endDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--start' && args[i + 1]) {
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
    } else if (args[i] === '--help') {
      console.log(`
Theta Data Downloader

Usage:
  npx tsx scripts/download-theta-data.ts [options]

Options:
  --start YYYYMMDD   Start date (default: 20221201)
  --end YYYYMMDD     End date (default: today)
  --month YYYYMM     Download single month
  --help             Show this help

Examples:
  npx tsx scripts/download-theta-data.ts
  npx tsx scripts/download-theta-data.ts --start 20230101 --end 20231231
  npx tsx scripts/download-theta-data.ts --month 202312
`);
      process.exit(0);
    }
  }

  console.log('='.repeat(60));
  console.log('Theta Historical Data Downloader');
  console.log('='.repeat(60));
  console.log(`Start: ${startDate}`);
  console.log(`End:   ${endDate}`);
  console.log('');

  // Check if Theta Terminal is running
  const available = await isThetaAvailable();
  if (!available) {
    console.error('ERROR: Theta Terminal is not running!');
    console.error('Start it with: java -jar ~/Desktop/ThetaTerminalv3.jar --creds-file ~/Desktop/creds.txt');
    process.exit(1);
  }

  console.log('Theta Terminal: Connected');
  console.log('');

  // Start download
  const startTime = Date.now();
  const progress = await downloadAll({
    symbol: 'SPY',
    startDate,
    endDate,
    interval: '1m',
    strikeRangePercent: 2,
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
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
```

**Step 2: Make executable and test**

Run: `chmod +x scripts/download-theta-data.ts`
Run: `npx tsx scripts/download-theta-data.ts --help`
Expected: Shows help text

**Step 3: Commit**

```bash
git add scripts/download-theta-data.ts
git commit -m "feat: add CLI script for Theta data download"
```

---

## Phase 2: Execute Download

### Task 5: Start Initial Download (December 2022)

**Step 1: Ensure Theta Terminal is running**

Run: `pgrep -f ThetaTerminal || echo "Not running"`

If not running:
```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
cd ~/Desktop && $JAVA_HOME/bin/java -jar ThetaTerminalv3.jar --creds-file creds.txt &
sleep 10
```

**Step 2: Create data directories**

```bash
mkdir -p data/theta/raw
mkdir -p data/theta/metadata
```

**Step 3: Start download for first month (test)**

```bash
npx tsx scripts/download-theta-data.ts --month 202212
```

Expected: Downloads ~20 trading days, ~80MB of data

**Step 4: Verify data**

```bash
ls -la data/theta/raw/202212/
zcat data/theta/raw/202212/20221201.json.gz | python3 -c "import sys,json; d=json.load(sys.stdin); print('OHLC records:', d['metadata']['recordCounts']['ohlc'])"
```

---

### Task 6: Download Full Date Range

**Step 1: Start full download (runs in background)**

```bash
nohup npx tsx scripts/download-theta-data.ts > logs/theta-download.log 2>&1 &
echo $! > logs/theta-download.pid
```

**Step 2: Monitor progress**

```bash
# Check progress
cat data/theta/metadata/download_progress.json | python3 -m json.tool

# Watch log
tail -f logs/theta-download.log

# Check disk usage
du -sh data/theta/
```

**Step 3: Resume if interrupted**

If the download is interrupted, just run again - it will resume from where it left off:

```bash
npx tsx scripts/download-theta-data.ts
```

---

## Phase 3: Data Validation

### Task 7: Create Data Validator

**Files:**
- Create: `/Users/home/Desktop/APE YOLO/APE-YOLO/scripts/validate-theta-data.ts`

**Step 1: Write the validator**

```typescript
#!/usr/bin/env npx tsx
/**
 * Validates downloaded Theta data for completeness and integrity
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';
import { getTradingDays } from '../server/services/theta/thetaClient';

const gunzip = promisify(zlib.gunzip);
const DATA_DIR = 'data/theta/raw';

interface ValidationResult {
  totalDays: number;
  validDays: number;
  missingDays: string[];
  corruptDays: string[];
  totalRecords: number;
  totalSizeBytes: number;
}

async function validateDay(filePath: string): Promise<{ valid: boolean; records: number; error?: string }> {
  try {
    const compressed = fs.readFileSync(filePath);
    const decompressed = await gunzip(compressed);
    const data = JSON.parse(decompressed.toString());

    const ohlcCount = data.metadata?.recordCounts?.ohlc || 0;
    if (ohlcCount === 0) {
      return { valid: false, records: 0, error: 'No OHLC records' };
    }

    return { valid: true, records: ohlcCount };
  } catch (error: any) {
    return { valid: false, records: 0, error: error.message };
  }
}

async function validate(startDate: string, endDate: string): Promise<ValidationResult> {
  const tradingDays = getTradingDays(startDate, endDate);
  const result: ValidationResult = {
    totalDays: tradingDays.length,
    validDays: 0,
    missingDays: [],
    corruptDays: [],
    totalRecords: 0,
    totalSizeBytes: 0,
  };

  for (const date of tradingDays) {
    const month = date.slice(0, 6);
    const filePath = path.join(DATA_DIR, month, `${date}.json.gz`);

    if (!fs.existsSync(filePath)) {
      result.missingDays.push(date);
      continue;
    }

    const validation = await validateDay(filePath);
    if (validation.valid) {
      result.validDays++;
      result.totalRecords += validation.records;
      result.totalSizeBytes += fs.statSync(filePath).size;
    } else {
      result.corruptDays.push(date);
      console.log(`Corrupt: ${date} - ${validation.error}`);
    }
  }

  return result;
}

async function main() {
  const startDate = process.argv[2] || '20221201';
  const endDate = process.argv[3] || new Date().toISOString().slice(0, 10).replace(/-/g, '');

  console.log(`Validating data from ${startDate} to ${endDate}...`);

  const result = await validate(startDate, endDate);

  console.log('\n=== Validation Results ===');
  console.log(`Total trading days: ${result.totalDays}`);
  console.log(`Valid days: ${result.validDays}`);
  console.log(`Missing days: ${result.missingDays.length}`);
  console.log(`Corrupt days: ${result.corruptDays.length}`);
  console.log(`Total records: ${result.totalRecords.toLocaleString()}`);
  console.log(`Total size: ${(result.totalSizeBytes / 1024 / 1024).toFixed(1)} MB`);

  if (result.missingDays.length > 0) {
    console.log('\nMissing days:');
    result.missingDays.forEach((d) => console.log(`  ${d}`));
  }

  if (result.corruptDays.length > 0) {
    console.log('\nCorrupt days:');
    result.corruptDays.forEach((d) => console.log(`  ${d}`));
  }
}

main().catch(console.error);
```

**Step 2: Run validation**

```bash
npx tsx scripts/validate-theta-data.ts
```

**Step 3: Commit**

```bash
git add scripts/validate-theta-data.ts
git commit -m "feat: add data validation script"
```

---

## Success Criteria

- [ ] Download infrastructure created (tracker, downloader, CLI)
- [ ] December 2022 downloaded successfully (~20 days)
- [ ] Full date range download started
- [ ] Progress tracking working (can resume after interruption)
- [ ] Data validation passing
- [ ] Total data size under 10GB
- [ ] All trading days from Dec 2022 to present have valid data

---

**Plan complete and saved to `docs/plans/2026-01-04-theta-data-download.md`.**

**Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
