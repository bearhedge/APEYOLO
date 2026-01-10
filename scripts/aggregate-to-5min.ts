#!/usr/bin/env npx tsx
/**
 * Aggregates 1-minute Theta options data to 5-minute bars
 *
 * Input: data/theta/raw/{SPY,QQQ}/YYYYMM/*.json (1-min)
 * Output: data/theta/processed/{SPY,QQQ}/YYYYMM/*.json (5-min)
 *
 * Also reconstructs underlying (SPY/QQQ) 5-min candles from underlying_price snapshots
 */

import * as fs from 'fs';
import * as path from 'path';

const RAW_DIR = '/Users/home/Desktop/APE YOLO/APE-YOLO/data/theta/raw';
const PROCESSED_DIR = '/Users/home/Desktop/APE YOLO/APE-YOLO/data/theta/processed';

interface RawDayData {
  date: string;
  symbol: string;
  ohlc: {
    timestamp: string[];
    strike: number[];
    right: string[];
    open: number[];
    high: number[];
    low: number[];
    close: number[];
    volume: number[];
    vwap: number[];
    count: number[];
    expiration: string[];
    symbol: string[];
  };
  greeks: {
    timestamp: string[];
    strike: number[];
    right: string[];
    delta: number[];
    theta: number[];
    vega: number[];
    rho: number[];
    implied_vol: number[];
    underlying_price: number[];
    bid: number[];
    ask: number[];
    expiration: string[];
  };
  quotes: {
    timestamp: string[];
    strike: number[];
    right: string[];
    bid: number[];
    ask: number[];
    bid_size: number[];
    ask_size: number[];
    expiration: string[];
  };
  openInterest: Record<string, unknown[]>;
  greeksEod: Record<string, unknown[]>;
  metadata: {
    symbol: string;
    expiration: string;
    interval: string;
    recordCounts: Record<string, number>;
    downloadedAt: string;
  };
}

interface AggregatedBar {
  timestamp: string;
  strike: number;
  right: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number;
  tradeCount: number;
}

interface AggregatedGreeks {
  timestamp: string;
  strike: number;
  right: string;
  delta: number;
  theta: number;
  vega: number;
  rho: number;
  iv: number;
  underlyingPrice: number;
  bid: number;
  ask: number;
}

interface AggregatedQuote {
  timestamp: string;
  strike: number;
  right: string;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  mid: number;
}

interface UnderlyingCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface ProcessedDayData {
  date: string;
  symbol: string;
  interval: '5m';

  // Reconstructed underlying candles
  underlyingBars: UnderlyingCandle[];

  // Aggregated options data
  optionsBars: AggregatedBar[];
  greeks: AggregatedGreeks[];
  quotes: AggregatedQuote[];

  // EOD data (unchanged)
  openInterest: Record<string, unknown[]>;
  greeksEod: Record<string, unknown[]>;

  metadata: {
    symbol: string;
    expiration: string;
    originalInterval: string;
    processedInterval: string;
    originalCounts: Record<string, number>;
    processedCounts: Record<string, number>;
    processedAt: string;
  };
}

function get5MinBucket(ts: string): string {
  // "2024-01-03T09:32:00" -> "2024-01-03T09:30:00"
  const [date, time] = ts.split('T');
  const [hour, minute] = time.split(':');
  const bucketMin = Math.floor(parseInt(minute) / 5) * 5;
  return `${date}T${hour}:${bucketMin.toString().padStart(2, '0')}:00`;
}

function aggregateOHLC(raw: RawDayData): AggregatedBar[] {
  // Group by (strike, right, 5-min bucket)
  const groups = new Map<string, { bars: { o: number; h: number; l: number; c: number; v: number; vwap: number; count: number; ts: string }[] }>();

  const { timestamp, strike, right, open, high, low, close, volume, vwap, count } = raw.ohlc;

  for (let i = 0; i < timestamp.length; i++) {
    const bucket = get5MinBucket(timestamp[i]);
    const key = `${strike[i]}|${right[i]}|${bucket}`;

    if (!groups.has(key)) {
      groups.set(key, { bars: [] });
    }

    groups.get(key)!.bars.push({
      o: open[i],
      h: high[i],
      l: low[i],
      c: close[i],
      v: volume[i],
      vwap: vwap[i],
      count: count[i],
      ts: timestamp[i]
    });
  }

  const result: AggregatedBar[] = [];

  for (const [key, { bars }] of groups) {
    const [strikeStr, rightStr, bucket] = key.split('|');

    // Only include bars with at least one trade
    const tradedBars = bars.filter(b => b.v > 0);
    if (tradedBars.length === 0) continue;

    // Sort by timestamp
    tradedBars.sort((a, b) => a.ts.localeCompare(b.ts));

    const aggregated: AggregatedBar = {
      timestamp: bucket,
      strike: parseInt(strikeStr),
      right: rightStr,
      open: tradedBars[0].o,
      high: Math.max(...tradedBars.map(b => b.h)),
      low: Math.min(...tradedBars.filter(b => b.l > 0).map(b => b.l)) || 0,
      close: tradedBars[tradedBars.length - 1].c,
      volume: tradedBars.reduce((sum, b) => sum + b.v, 0),
      vwap: tradedBars.reduce((sum, b) => sum + b.vwap * b.v, 0) / tradedBars.reduce((sum, b) => sum + b.v, 0) || 0,
      tradeCount: tradedBars.reduce((sum, b) => sum + b.count, 0)
    };

    result.push(aggregated);
  }

  return result.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.strike - b.strike);
}

function aggregateGreeks(raw: RawDayData): AggregatedGreeks[] {
  // Group by (strike, right, 5-min bucket), take last value in each bucket
  const groups = new Map<string, { ts: string; delta: number; theta: number; vega: number; rho: number; iv: number; up: number; bid: number; ask: number }>();

  const { timestamp, strike, right, delta, theta, vega, rho, implied_vol, underlying_price, bid, ask } = raw.greeks;

  for (let i = 0; i < timestamp.length; i++) {
    const bucket = get5MinBucket(timestamp[i]);
    const key = `${strike[i]}|${right[i]}|${bucket}`;

    // Keep the last (most recent) value for each bucket
    const existing = groups.get(key);
    if (!existing || timestamp[i] > existing.ts) {
      groups.set(key, {
        ts: timestamp[i],
        delta: delta[i],
        theta: theta[i],
        vega: vega[i],
        rho: rho[i],
        iv: implied_vol[i],
        up: underlying_price[i],
        bid: bid[i],
        ask: ask[i]
      });
    }
  }

  const result: AggregatedGreeks[] = [];

  for (const [key, data] of groups) {
    const [strikeStr, rightStr, bucket] = key.split('|');

    // Skip if no valid data
    if (data.delta === 0 && data.iv === 0) continue;

    result.push({
      timestamp: bucket,
      strike: parseInt(strikeStr),
      right: rightStr,
      delta: data.delta,
      theta: data.theta,
      vega: data.vega,
      rho: data.rho,
      iv: data.iv,
      underlyingPrice: data.up,
      bid: data.bid,
      ask: data.ask
    });
  }

  return result.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.strike - b.strike);
}

function aggregateQuotes(raw: RawDayData): AggregatedQuote[] {
  // Group by (strike, right, 5-min bucket), take last value in each bucket
  const groups = new Map<string, { ts: string; bid: number; ask: number; bidSize: number; askSize: number }>();

  const { timestamp, strike, right, bid, ask, bid_size, ask_size } = raw.quotes;

  for (let i = 0; i < timestamp.length; i++) {
    const bucket = get5MinBucket(timestamp[i]);
    const key = `${strike[i]}|${right[i]}|${bucket}`;

    // Keep the last (most recent) value for each bucket
    const existing = groups.get(key);
    if (!existing || timestamp[i] > existing.ts) {
      groups.set(key, {
        ts: timestamp[i],
        bid: bid[i],
        ask: ask[i],
        bidSize: bid_size[i],
        askSize: ask_size[i]
      });
    }
  }

  const result: AggregatedQuote[] = [];

  for (const [key, data] of groups) {
    const [strikeStr, rightStr, bucket] = key.split('|');

    // Skip if no valid quote
    if (data.bid === 0 && data.ask === 0) continue;

    result.push({
      timestamp: bucket,
      strike: parseInt(strikeStr),
      right: rightStr,
      bid: data.bid,
      ask: data.ask,
      bidSize: data.bidSize,
      askSize: data.askSize,
      mid: (data.bid + data.ask) / 2
    });
  }

  return result.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.strike - b.strike);
}

function reconstructUnderlyingCandles(raw: RawDayData): UnderlyingCandle[] {
  // Extract underlying_price from Greeks data, group by 5-min bucket
  const groups = new Map<string, number[]>();

  const { timestamp, underlying_price } = raw.greeks;

  for (let i = 0; i < timestamp.length; i++) {
    if (underlying_price[i] > 0) {
      const bucket = get5MinBucket(timestamp[i]);
      if (!groups.has(bucket)) {
        groups.set(bucket, []);
      }
      groups.get(bucket)!.push(underlying_price[i]);
    }
  }

  const result: UnderlyingCandle[] = [];

  for (const [bucket, prices] of groups) {
    if (prices.length === 0) continue;

    result.push({
      timestamp: bucket,
      open: prices[0],
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: prices[prices.length - 1]
    });
  }

  return result.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function processDay(rawPath: string, outputPath: string): { success: boolean; stats: Record<string, number> } {
  try {
    const rawData: RawDayData = JSON.parse(fs.readFileSync(rawPath, 'utf-8'));

    // Aggregate each data type
    const underlyingBars = reconstructUnderlyingCandles(rawData);
    const optionsBars = aggregateOHLC(rawData);
    const greeks = aggregateGreeks(rawData);
    const quotes = aggregateQuotes(rawData);

    const processed: ProcessedDayData = {
      date: rawData.date,
      symbol: rawData.symbol,
      interval: '5m',
      underlyingBars,
      optionsBars,
      greeks,
      quotes,
      openInterest: rawData.openInterest,
      greeksEod: rawData.greeksEod,
      metadata: {
        symbol: rawData.symbol,
        expiration: rawData.metadata.expiration,
        originalInterval: rawData.metadata.interval,
        processedInterval: '5m',
        originalCounts: rawData.metadata.recordCounts,
        processedCounts: {
          underlyingBars: underlyingBars.length,
          optionsBars: optionsBars.length,
          greeks: greeks.length,
          quotes: quotes.length
        },
        processedAt: new Date().toISOString()
      }
    };

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write processed data
    fs.writeFileSync(outputPath, JSON.stringify(processed));

    return {
      success: true,
      stats: processed.metadata.processedCounts
    };
  } catch (error) {
    console.error(`Error processing ${rawPath}:`, error);
    return { success: false, stats: {} };
  }
}

async function main() {
  const symbols = ['SPY', 'QQQ'];

  console.log('=' .repeat(70));
  console.log('AGGREGATING 1-MIN → 5-MIN');
  console.log('=' .repeat(70));

  for (const symbol of symbols) {
    const symbolRawDir = path.join(RAW_DIR, symbol);
    const symbolProcessedDir = path.join(PROCESSED_DIR, symbol);

    if (!fs.existsSync(symbolRawDir)) {
      console.log(`\n${symbol}: No raw data found, skipping`);
      continue;
    }

    const monthDirs = fs.readdirSync(symbolRawDir).filter(d =>
      fs.statSync(path.join(symbolRawDir, d)).isDirectory()
    ).sort();

    console.log(`\n${symbol}: Processing ${monthDirs.length} months...`);

    let totalDays = 0;
    let processedDays = 0;
    let totalStats = { underlyingBars: 0, optionsBars: 0, greeks: 0, quotes: 0 };

    for (const month of monthDirs) {
      const monthRawDir = path.join(symbolRawDir, month);
      const monthProcessedDir = path.join(symbolProcessedDir, month);

      const dayFiles = fs.readdirSync(monthRawDir)
        .filter(f => f.endsWith('.json'))
        .sort();

      for (const dayFile of dayFiles) {
        totalDays++;
        const rawPath = path.join(monthRawDir, dayFile);
        const outputPath = path.join(monthProcessedDir, dayFile);

        const { success, stats } = processDay(rawPath, outputPath);

        if (success) {
          processedDays++;
          totalStats.underlyingBars += stats.underlyingBars || 0;
          totalStats.optionsBars += stats.optionsBars || 0;
          totalStats.greeks += stats.greeks || 0;
          totalStats.quotes += stats.quotes || 0;
        }

        if (totalDays % 100 === 0) {
          console.log(`  Processed ${totalDays} days...`);
        }
      }
    }

    console.log(`\n${symbol} Complete:`);
    console.log(`  Days processed: ${processedDays}/${totalDays}`);
    console.log(`  Underlying 5-min bars: ${totalStats.underlyingBars.toLocaleString()}`);
    console.log(`  Options 5-min bars: ${totalStats.optionsBars.toLocaleString()}`);
    console.log(`  Greeks 5-min: ${totalStats.greeks.toLocaleString()}`);
    console.log(`  Quotes 5-min: ${totalStats.quotes.toLocaleString()}`);
  }

  console.log('\n' + '=' .repeat(70));
  console.log('AGGREGATION COMPLETE');
  console.log('=' .repeat(70));
  console.log(`\nProcessed data saved to: ${PROCESSED_DIR}`);
}

main().catch(console.error);
