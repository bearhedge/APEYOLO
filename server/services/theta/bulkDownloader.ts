/**
 * Bulk Downloader for Theta Historical Options Data
 *
 * Downloads SPY 0DTE options data organized by month.
 * Supports resumable downloads and rate limiting.
 *
 * Data types downloaded:
 * - OHLC (1-minute bars)
 * - Greeks first_order (delta, theta, vega, rho, IV)
 * - Quotes (bid/ask)
 * - Open Interest
 * - Greeks EOD (all 44 Greeks fields)
 */

import * as fs from 'fs';
import * as path from 'path';
import { getTradingDays } from './thetaClient';
const THETA_BASE_URL = process.env.THETA_BASE_URL || 'http://localhost:25503';
const DATA_DIR = 'data/theta';

// Rate limiting
const DELAY_BETWEEN_DAYS = 500; // ms

interface DownloadConfig {
  symbol: string;
  startDate: string; // YYYYMMDD
  endDate: string; // YYYYMMDD
  interval: '1m' | '5m';
  includeGreeks: boolean;
  includeQuotes: boolean;
  includeTrades: boolean;
}

interface DownloadProgress {
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

interface DayData {
  date: string;
  symbol: string;
  ohlc: unknown;
  greeks?: unknown;
  quotes?: unknown;
  openInterest: unknown;
  greeksEod?: unknown;
  metadata: {
    symbol: string;
    expiration: string;
    interval: string;
    recordCounts: {
      ohlc: number;
      greeks?: number;
      quotes?: number;
      oi: number;
      greeksEod?: number;
    };
    downloadedAt: string;
  };
}

// Progress file will be set per-symbol
let PROGRESS_FILE = path.join(DATA_DIR, 'metadata', 'download_progress.json');

function getProgressFile(symbol: string): string {
  return path.join(DATA_DIR, 'metadata', `download_progress_${symbol}.json`);
}

// ============================================
// Progress Tracking
// ============================================

function loadProgress(symbol: string): DownloadProgress | null {
  try {
    const progressFile = getProgressFile(symbol);
    if (fs.existsSync(progressFile)) {
      const data = fs.readFileSync(progressFile, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('[DownloadTracker] Error loading progress:', error);
  }
  return null;
}

function saveProgress(progress: DownloadProgress, symbol: string): void {
  const progressFile = getProgressFile(symbol);
  const dir = path.dirname(progressFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  progress.lastUpdated = new Date().toISOString();
  fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));
}

function initProgress(startDate: string, endDate: string): DownloadProgress {
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

function markDayCompleted(progress: DownloadProgress, date: string, bytes: number, symbol: string): void {
  if (!progress.completedDays.includes(date)) {
    progress.completedDays.push(date);
    progress.stats.completedCount++;
    progress.stats.totalBytes += bytes;
  }
  saveProgress(progress, symbol);
}

function markDayFailed(progress: DownloadProgress, date: string, error: string, symbol: string): void {
  progress.failedDays.push({ date, error });
  progress.stats.failedCount++;
  saveProgress(progress, symbol);
}

function isDayCompleted(progress: DownloadProgress, date: string): boolean {
  return progress.completedDays.includes(date);
}

// ============================================
// Data Fetching
// ============================================

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;

      const text = await response.text();
      if (text.includes('requires a professional subscription')) {
        throw new Error('Requires PROFESSIONAL subscription');
      }
      if (i < retries - 1) {
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      }
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw new Error('Max retries exceeded');
}

async function fetchDayOHLC(
  symbol: string,
  date: string,
  interval: string
): Promise<unknown> {
  const url = `${THETA_BASE_URL}/v3/option/history/ohlc?symbol=${symbol}&expiration=${date}&date=${date}&strike=*&right=both&interval=${interval}&format=json`;
  const response = await fetchWithRetry(url);
  return response.json();
}

async function fetchDayGreeksFirstOrder(
  symbol: string,
  date: string,
  interval: string
): Promise<unknown> {
  const url = `${THETA_BASE_URL}/v3/option/history/greeks/first_order?symbol=${symbol}&expiration=${date}&date=${date}&strike=*&right=both&interval=${interval}&format=json`;
  const response = await fetchWithRetry(url);
  return response.json();
}

async function fetchDayQuotes(
  symbol: string,
  date: string,
  interval: string
): Promise<unknown> {
  const url = `${THETA_BASE_URL}/v3/option/history/quote?symbol=${symbol}&expiration=${date}&date=${date}&strike=*&right=both&interval=${interval}&format=json`;
  const response = await fetchWithRetry(url);
  return response.json();
}

async function fetchDayOpenInterest(
  symbol: string,
  date: string
): Promise<unknown> {
  const url = `${THETA_BASE_URL}/v3/option/history/open_interest?symbol=${symbol}&expiration=${date}&date=${date}&strike=*&right=both&format=json`;
  const response = await fetchWithRetry(url);
  return response.json();
}

async function fetchDayGreeksEOD(
  symbol: string,
  date: string
): Promise<unknown> {
  const url = `${THETA_BASE_URL}/v3/option/history/greeks/eod?symbol=${symbol}&expiration=${date}&start_date=${date}&end_date=${date}&strike=*&right=both&format=json`;
  const response = await fetchWithRetry(url);
  return response.json();
}

/**
 * Download all data for a single day
 */
async function downloadDay(
  symbol: string,
  date: string,
  config: DownloadConfig
): Promise<DayData> {
  console.log(`[BulkDownload] Fetching ${date}...`);

  // Build list of fetches to run in parallel
  const fetches: Promise<unknown>[] = [
    fetchDayOHLC(symbol, date, config.interval),
    fetchDayOpenInterest(symbol, date),
    fetchDayGreeksEOD(symbol, date),
  ];

  if (config.includeGreeks) {
    fetches.push(fetchDayGreeksFirstOrder(symbol, date, config.interval));
  }
  if (config.includeQuotes) {
    fetches.push(fetchDayQuotes(symbol, date, config.interval));
  }

  const results = await Promise.all(fetches);

  const ohlc = results[0];
  const openInterest = results[1];
  const greeksEod = results[2];
  const greeks = config.includeGreeks ? results[3] : undefined;
  const quotes = config.includeQuotes ? results[config.includeGreeks ? 4 : 3] : undefined;

  const getCount = (data: unknown, field: string) => {
    if (data && typeof data === 'object' && field in data) {
      return (data as Record<string, unknown[]>)[field]?.length || 0;
    }
    return 0;
  };

  return {
    date,
    symbol,
    ohlc,
    greeks,
    quotes,
    openInterest,
    greeksEod,
    metadata: {
      symbol,
      expiration: date,
      interval: config.interval,
      recordCounts: {
        ohlc: getCount(ohlc, 'timestamp'),
        greeks: greeks ? getCount(greeks, 'timestamp') : undefined,
        quotes: quotes ? getCount(quotes, 'timestamp') : undefined,
        oi: getCount(openInterest, 'strike'),
        greeksEod: getCount(greeksEod, 'strike'),
      },
      downloadedAt: new Date().toISOString(),
    },
  };
}

/**
 * Save day data to JSON file (uncompressed for fast reads)
 * Organized by symbol/month/date.json
 */
async function saveDayData(data: DayData): Promise<number> {
  const month = data.date.slice(0, 6);
  const dir = path.join(DATA_DIR, 'raw', data.symbol, month);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filePath = path.join(dir, `${data.date}.json`);
  const jsonData = JSON.stringify(data);

  fs.writeFileSync(filePath, jsonData);

  return jsonData.length;
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
  const startDate = Math.max(parseInt(config.startDate), parseInt(monthStart)).toString().padStart(8, '0');
  const endDate = Math.min(parseInt(config.endDate), parseInt(monthEnd)).toString().padStart(8, '0');

  const tradingDays = getTradingDays(startDate, endDate);

  console.log(`[BulkDownload] Month ${month}: ${tradingDays.length} trading days`);

  for (const date of tradingDays) {
    // Skip if already completed
    if (isDayCompleted(progress, date)) {
      console.log(`[BulkDownload] Skipping ${date} (already completed)`);
      continue;
    }

    try {
      const dayData = await downloadDay(config.symbol, date, config);
      const bytes = await saveDayData(dayData);
      markDayCompleted(progress, date, bytes, config.symbol);

      const counts = dayData.metadata.recordCounts;
      console.log(
        `[BulkDownload] Saved ${date}: ` +
        `OHLC=${counts.ohlc}, ` +
        `Greeks=${counts.greeks || 'N/A'}, ` +
        `Quotes=${counts.quotes || 'N/A'}, ` +
        `OI=${counts.oi}, ` +
        `GreeksEOD=${counts.greeksEod} ` +
        `(${(bytes / 1024).toFixed(1)} KB)`
      );

      // Rate limiting
      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_DAYS));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[BulkDownload] Failed ${date}:`, message);
      markDayFailed(progress, date, message, config.symbol);
    }
  }
}

/**
 * Main download function - downloads all data for date range
 */
export async function downloadAll(config: DownloadConfig): Promise<DownloadProgress> {
  console.log(`[BulkDownload] Starting download: ${config.startDate} to ${config.endDate}`);
  console.log(`[BulkDownload] Config: interval=${config.interval}, greeks=${config.includeGreeks}, quotes=${config.includeQuotes}`);

  // Ensure data directories exist
  fs.mkdirSync(path.join(DATA_DIR, 'raw'), { recursive: true });
  fs.mkdirSync(path.join(DATA_DIR, 'metadata'), { recursive: true });

  // Load or initialize progress
  let progress = loadProgress(config.symbol);
  if (!progress || progress.startDate !== config.startDate || progress.endDate !== config.endDate) {
    progress = initProgress(config.startDate, config.endDate);
  }

  const months = getMonthsBetween(config.startDate, config.endDate);
  progress.stats.totalDays = getTradingDays(config.startDate, config.endDate).length;
  saveProgress(progress, config.symbol);

  console.log(`[BulkDownload] ${months.length} months, ~${progress.stats.totalDays} trading days`);

  for (const month of months) {
    console.log(`\n[BulkDownload] === Processing ${month} ===`);
    progress.currentMonth = month;
    saveProgress(progress, config.symbol);

    await downloadMonth(config, month, progress);
  }

  console.log(`\n[BulkDownload] === Complete ===`);
  console.log(`Completed: ${progress.stats.completedCount}/${progress.stats.totalDays}`);
  console.log(`Failed: ${progress.stats.failedCount}`);
  console.log(`Total size: ${(progress.stats.totalBytes / 1024 / 1024).toFixed(1)} MB`);

  return progress;
}

/**
 * Check if Theta Terminal is available
 */
export async function isThetaAvailable(): Promise<boolean> {
  try {
    // Test with a simple OHLC request
    const response = await fetch(
      `${THETA_BASE_URL}/v3/option/history/ohlc?symbol=SPY&expiration=20241220&date=20241220&strike=590&right=C&interval=1h&format=json`,
      { signal: AbortSignal.timeout(5000) }
    );
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * CLI entry point
 */
export async function runDownload(): Promise<void> {
  const config: DownloadConfig = {
    symbol: 'SPY',
    startDate: '20221201',
    endDate: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    interval: '1m',
    includeGreeks: true,
    includeQuotes: true,
    includeTrades: false, // Trade data is large, skip for now
  };

  await downloadAll(config);
}

