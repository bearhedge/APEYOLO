// @ts-nocheck
/**
 * Replay API Routes
 *
 * Serves historical market data from Theta processed files for the Replay Trainer.
 * Supports both local filesystem and Google Cloud Storage.
 *
 * Data Sources (in order of preference):
 * 1. Local filesystem: data/theta/processed/
 * 2. GCS bucket: gs://apeyolo-replay-data/
 */

import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { Storage } from '@google-cloud/storage';

const router = Router();

// Path to local processed Theta data
const LOCAL_DATA_PATH = path.join(process.cwd(), 'data', 'theta', 'processed');

// GCS bucket configuration
const GCS_BUCKET = 'apeyolo-replay-data';
const storage = new Storage();

// In-memory cache for GCS data (to avoid repeated fetches)
const dataCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// List of available dates per symbol (cached)
const datesCache = new Map<string, { dates: string[]; timestamp: number }>();
const DATES_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Check if local data exists for a symbol
 */
function hasLocalData(symbol: string): boolean {
  const symbolPath = path.join(LOCAL_DATA_PATH, symbol.toUpperCase());
  return fs.existsSync(symbolPath);
}

/**
 * Read data file from local filesystem
 */
function readLocalFile(symbol: string, monthDir: string, fileName: string): any | null {
  const filePath = path.join(LOCAL_DATA_PATH, symbol.toUpperCase(), monthDir, fileName);
  if (!fs.existsSync(filePath)) return null;
  const rawData = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(rawData);
}

/**
 * Read data file from GCS
 */
async function readGCSFile(symbol: string, monthDir: string, fileName: string): Promise<any | null> {
  const cacheKey = `${symbol}/${monthDir}/${fileName}`;

  // Check cache first
  const cached = dataCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const gcsPath = `${symbol.toUpperCase()}/${monthDir}/${fileName}`;
    const bucket = storage.bucket(GCS_BUCKET);
    const file = bucket.file(gcsPath);

    const [exists] = await file.exists();
    if (!exists) return null;

    const [contents] = await file.download();
    const data = JSON.parse(contents.toString('utf-8'));

    // Cache the data
    dataCache.set(cacheKey, { data, timestamp: Date.now() });

    return data;
  } catch (error) {
    console.error(`GCS read error for ${cacheKey}:`, error);
    return null;
  }
}

/**
 * Read data from either local or GCS
 */
async function readDataFile(symbol: string, monthDir: string, fileName: string): Promise<any | null> {
  // Try local first
  const localData = readLocalFile(symbol, monthDir, fileName);
  if (localData) return localData;

  // Fall back to GCS
  return readGCSFile(symbol, monthDir, fileName);
}

/**
 * Get available dates from local filesystem
 */
function getLocalDates(symbol: string): string[] {
  const symbolPath = path.join(LOCAL_DATA_PATH, symbol.toUpperCase());
  if (!fs.existsSync(symbolPath)) return [];

  const months = fs.readdirSync(symbolPath).filter(f =>
    fs.statSync(path.join(symbolPath, f)).isDirectory()
  );

  const dates: string[] = [];
  for (const month of months) {
    const monthPath = path.join(symbolPath, month);
    const files = fs.readdirSync(monthPath).filter(f => f.endsWith('.json'));

    for (const file of files) {
      const dateStr = file.replace('.json', '');
      const formatted = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
      dates.push(formatted);
    }
  }

  return dates.sort();
}

/**
 * Get available dates from GCS
 */
async function getGCSDates(symbol: string): Promise<string[]> {
  // Check cache
  const cached = datesCache.get(symbol);
  if (cached && Date.now() - cached.timestamp < DATES_CACHE_TTL) {
    return cached.dates;
  }

  try {
    const bucket = storage.bucket(GCS_BUCKET);

    // List all JSON files under the symbol prefix
    const [files] = await bucket.getFiles({
      prefix: `${symbol.toUpperCase()}/`,
    });

    const dates: string[] = [];
    for (const file of files) {
      const fileName = file.name.split('/').pop();
      // Match files like 20230103.json
      if (fileName?.match(/^\d{8}\.json$/)) {
        const dateStr = fileName.replace('.json', '');
        const formatted = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
        dates.push(formatted);
      }
    }

    const sortedDates = dates.sort();

    console.log(`[Replay] GCS found ${sortedDates.length} dates for ${symbol}`);

    // Cache the result
    datesCache.set(symbol, { dates: sortedDates, timestamp: Date.now() });

    return sortedDates;
  } catch (error) {
    console.error(`GCS dates error for ${symbol}:`, error);
    return [];
  }
}

/**
 * GET /api/replay/dates/:symbol
 *
 * Get list of available trading dates for a symbol.
 * Returns array of dates in YYYY-MM-DD format.
 */
router.get('/dates/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;

    // Try local first
    let dates = getLocalDates(symbol);
    let source = 'local';

    // Fall back to GCS if no local data
    if (dates.length === 0) {
      dates = await getGCSDates(symbol);
      source = 'gcs';
    }

    if (dates.length === 0) {
      console.log(`[Replay] No data found for ${symbol} (checked local and GCS)`);
      res.status(404).json({ error: `No data for symbol ${symbol}` });
      return;
    }

    console.log(`[Replay] Found ${dates.length} dates for ${symbol} from ${source}`);

    res.json({
      symbol: symbol.toUpperCase(),
      count: dates.length,
      dates,
      source
    });
  } catch (error) {
    console.error('Failed to get replay dates:', error);
    res.status(500).json({ error: 'Failed to get replay dates' });
  }
});

/**
 * GET /api/replay/day/:symbol/:date
 *
 * Get complete data for a specific trading day.
 * Returns OHLC candles and options chain data.
 *
 * Query params:
 * - time: Optional time filter (e.g., "10:30" to get data up to that time)
 */
router.get('/day/:symbol/:date', async (req, res) => {
  try {
    const { symbol, date } = req.params;
    const { time } = req.query;

    // Convert 2023-01-03 to 202301/20230103.json
    const dateParts = date.split('-');
    const monthDir = `${dateParts[0]}${dateParts[1]}`;
    const fileName = `${dateParts.join('')}.json`;

    const data = await readDataFile(symbol, monthDir, fileName);

    if (!data) {
      res.status(404).json({ error: `No data for ${symbol} on ${date}` });
      return;
    }

    // Filter by time if specified
    let candles = data.underlyingBars || [];
    let greeks = data.greeks || [];
    let quotes = data.quotes || [];

    if (time) {
      const timeFilter = `${date}T${time}`;
      candles = candles.filter((c: any) => c.timestamp <= timeFilter);
      greeks = greeks.filter((g: any) => g.timestamp <= timeFilter);
      quotes = quotes.filter((q: any) => q.timestamp <= timeFilter);
    }

    // Get latest price from candles
    const latestCandle = candles[candles.length - 1];
    const spotPrice = latestCandle?.close || 0;

    // Build options chain from latest greeks/quotes
    // Group by strike and right, take latest for each
    const optionsMap = new Map<string, any>();

    for (const g of greeks) {
      const key = `${g.strike}-${g.right}`;
      const existing = optionsMap.get(key);
      if (!existing || g.timestamp > existing.timestamp) {
        optionsMap.set(key, {
          strike: g.strike,
          right: g.right,
          delta: g.delta,
          theta: g.theta,
          vega: g.vega,
          iv: g.iv,
          timestamp: g.timestamp,
          bid: g.bid || 0,
          ask: g.ask || 0,
        });
      }
    }

    // Merge in quote data
    for (const q of quotes) {
      const key = `${q.strike}-${q.right}`;
      const existing = optionsMap.get(key);
      if (existing && q.timestamp >= existing.timestamp) {
        existing.bid = q.bid;
        existing.ask = q.ask;
        existing.volume = q.volume || 0;
      }
    }

    // Convert to array and sort by strike
    const options = Array.from(optionsMap.values())
      .filter(o => o.strike >= spotPrice - 20 && o.strike <= spotPrice + 20) // Filter to relevant strikes
      .sort((a, b) => a.strike - b.strike);

    res.json({
      date,
      symbol: symbol.toUpperCase(),
      spotPrice,
      candles,
      options,
      metadata: data.metadata || {},
    });
  } catch (error) {
    console.error('Failed to get replay day data:', error);
    res.status(500).json({ error: 'Failed to get replay day data' });
  }
});

/**
 * GET /api/replay/candles/:symbol/:date
 *
 * Get just the OHLC candles for a specific day.
 * Lighter endpoint for chart data only.
 */
router.get('/candles/:symbol/:date', async (req, res) => {
  try {
    const { symbol, date } = req.params;
    const { time } = req.query;

    const dateParts = date.split('-');
    const monthDir = `${dateParts[0]}${dateParts[1]}`;
    const fileName = `${dateParts.join('')}.json`;

    const data = await readDataFile(symbol, monthDir, fileName);

    if (!data) {
      res.status(404).json({ error: `No data for ${symbol} on ${date}` });
      return;
    }

    let candles = data.underlyingBars || [];

    if (time) {
      const timeFilter = `${date}T${time}`;
      candles = candles.filter((c: any) => c.timestamp <= timeFilter);
    }

    res.json({
      date,
      symbol: symbol.toUpperCase(),
      interval: data.interval || '5m',
      count: candles.length,
      candles,
    });
  } catch (error) {
    console.error('Failed to get candles:', error);
    res.status(500).json({ error: 'Failed to get candles' });
  }
});

/**
 * GET /api/replay/options/:symbol/:date
 *
 * Get options chain for a specific day and time.
 */
router.get('/options/:symbol/:date', async (req, res) => {
  try {
    const { symbol, date } = req.params;
    const { time } = req.query;

    const dateParts = date.split('-');
    const monthDir = `${dateParts[0]}${dateParts[1]}`;
    const fileName = `${dateParts.join('')}.json`;

    const data = await readDataFile(symbol, monthDir, fileName);

    if (!data) {
      res.status(404).json({ error: `No data for ${symbol} on ${date}` });
      return;
    }

    let greeks = data.greeks || [];
    let quotes = data.quotes || [];
    let candles = data.underlyingBars || [];

    if (time) {
      const timeFilter = `${date}T${time}`;
      greeks = greeks.filter((g: any) => g.timestamp <= timeFilter);
      quotes = quotes.filter((q: any) => q.timestamp <= timeFilter);
      candles = candles.filter((c: any) => c.timestamp <= timeFilter);
    }

    // Get spot price
    const latestCandle = candles[candles.length - 1];
    const spotPrice = latestCandle?.close || 0;

    // Build options chain
    const optionsMap = new Map<string, any>();

    for (const g of greeks) {
      const key = `${g.strike}-${g.right}`;
      const existing = optionsMap.get(key);
      if (!existing || g.timestamp > existing.timestamp) {
        optionsMap.set(key, {
          strike: g.strike,
          right: g.right,
          delta: g.delta,
          theta: g.theta,
          vega: g.vega,
          iv: g.iv,
          timestamp: g.timestamp,
          bid: g.bid || 0,
          ask: g.ask || 0,
          volume: 0,
          oi: 0,
        });
      }
    }

    for (const q of quotes) {
      const key = `${q.strike}-${q.right}`;
      const existing = optionsMap.get(key);
      if (existing && q.timestamp >= existing.timestamp) {
        existing.bid = q.bid;
        existing.ask = q.ask;
        existing.volume = q.volume || 0;
      }
    }

    const options = Array.from(optionsMap.values())
      .filter(o => o.strike >= spotPrice - 20 && o.strike <= spotPrice + 20)
      .sort((a, b) => a.strike - b.strike);

    res.json({
      date,
      symbol: symbol.toUpperCase(),
      time: time || 'latest',
      spotPrice,
      count: options.length,
      options,
    });
  } catch (error) {
    console.error('Failed to get options:', error);
    res.status(500).json({ error: 'Failed to get options' });
  }
});

/**
 * GET /api/replay/outcome/:symbol/:date
 *
 * Get the day's outcome (close price, direction).
 * Used to reveal results after user makes decision.
 */
router.get('/outcome/:symbol/:date', async (req, res) => {
  try {
    const { symbol, date } = req.params;

    const dateParts = date.split('-');
    const monthDir = `${dateParts[0]}${dateParts[1]}`;
    const fileName = `${dateParts.join('')}.json`;

    const data = await readDataFile(symbol, monthDir, fileName);

    if (!data) {
      res.status(404).json({ error: `No data for ${symbol} on ${date}` });
      return;
    }

    const candles = data.underlyingBars || [];
    if (candles.length === 0) {
      res.status(404).json({ error: 'No candle data' });
      return;
    }

    const firstCandle = candles[0];
    const lastCandle = candles[candles.length - 1];

    const openPrice = firstCandle.open;
    const closePrice = lastCandle.close;
    const highPrice = Math.max(...candles.map((c: any) => c.high));
    const lowPrice = Math.min(...candles.map((c: any) => c.low));

    const change = closePrice - openPrice;
    const changePercent = (change / openPrice) * 100;

    let direction: 'BULLISH' | 'BEARISH' | 'FLAT';
    if (changePercent > 0.1) direction = 'BULLISH';
    else if (changePercent < -0.1) direction = 'BEARISH';
    else direction = 'FLAT';

    res.json({
      date,
      symbol: symbol.toUpperCase(),
      openPrice,
      closePrice,
      highPrice,
      lowPrice,
      change,
      changePercent,
      direction,
    });
  } catch (error) {
    console.error('Failed to get outcome:', error);
    res.status(500).json({ error: 'Failed to get outcome' });
  }
});

/**
 * GET /api/replay/multi-day/:symbol/:date
 *
 * Get data for a date plus N previous trading days for context.
 * Returns candles for all days combined with date markers.
 *
 * Query params:
 * - context: Number of previous days to include (default: 3)
 * - time: Optional time filter for the target date (e.g., "11:00")
 */
router.get('/multi-day/:symbol/:date', async (req, res) => {
  try {
    const { symbol, date } = req.params;
    // Validate and limit contextDays to prevent memory issues (max 10 days)
    const rawContextDays = parseInt(req.query.context as string) || 3;
    const contextDays = Math.min(10, Math.max(0, rawContextDays));
    const upToTime = req.query.time as string | undefined;

    // Get list of available dates
    let allDates = getLocalDates(symbol);
    if (allDates.length === 0) {
      allDates = await getGCSDates(symbol);
    }

    if (allDates.length === 0) {
      res.status(404).json({ error: `No data for symbol ${symbol}` });
      return;
    }

    // Find target date index
    const targetIndex = allDates.indexOf(date);
    if (targetIndex === -1) {
      res.status(404).json({ error: `Date ${date} not found` });
      return;
    }

    // Get previous N days + target day
    const startIndex = Math.max(0, targetIndex - contextDays);
    const datesToFetch = allDates.slice(startIndex, targetIndex + 1);

    // Fetch all days
    const allCandles: any[] = [];
    const dateMarkers: { date: string; startIndex: number }[] = [];

    for (const d of datesToFetch) {
      const dateParts = d.split('-');
      const monthDir = `${dateParts[0]}${dateParts[1]}`;
      const fileName = `${dateParts.join('')}.json`;

      const data = await readDataFile(symbol, monthDir, fileName);
      if (data?.underlyingBars) {
        let candles = data.underlyingBars;

        // If this is the target date and time filter is specified
        if (d === date && upToTime) {
          const timeFilter = `${d}T${upToTime}`;
          candles = candles.filter((c: any) => c.timestamp <= timeFilter);
        }

        dateMarkers.push({ date: d, startIndex: allCandles.length });
        allCandles.push(...candles);
      }
    }

    // Get current spot price (last candle)
    const spotPrice = allCandles.length > 0
      ? allCandles[allCandles.length - 1].close
      : 0;

    res.json({
      symbol: symbol.toUpperCase(),
      targetDate: date,
      contextDays: datesToFetch.length - 1,
      dateMarkers,
      candles: allCandles,
      spotPrice,
      candleCount: allCandles.length,
    });
  } catch (error) {
    console.error('Failed to get multi-day data:', error);
    res.status(500).json({ error: 'Failed to get multi-day data' });
  }
});

export default router;
