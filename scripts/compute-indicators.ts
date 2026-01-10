#!/usr/bin/env npx tsx
/**
 * Computes technical indicators from 5-minute processed data
 *
 * Input: data/theta/processed/{SPY,QQQ}/YYYYMM/YYYYMMDD.json
 * Output: data/theta/indicators/{SPY,QQQ}/YYYYMM/YYYYMMDD.json
 *
 * Indicators computed:
 * - SMA(20), SMA(50), EMA(9), EMA(21)
 * - RSI(14)
 * - MACD(12,26,9)
 * - Bollinger Bands (20, 2std)
 * - ATR(14)
 * - Trend/Momentum/Volatility signals
 */

import * as fs from 'fs';
import * as path from 'path';

const PROCESSED_DIR = '/Users/home/Desktop/APE YOLO/APE-YOLO/data/theta/processed';
const INDICATORS_DIR = '/Users/home/Desktop/APE YOLO/APE-YOLO/data/theta/indicators';
const VIX_PATH = '/Users/home/Desktop/APE YOLO/APE-YOLO/data/theta/raw/VIX/vix_daily.json';

interface UnderlyingBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface ProcessedDayData {
  date: string;
  symbol: string;
  interval: string;
  underlyingBars: UnderlyingBar[];
}

interface IndicatorBar {
  timestamp: string;
  price: number;
  open: number;
  high: number;
  low: number;

  // Trend indicators
  sma20: number | null;
  sma50: number | null;
  ema9: number | null;
  ema21: number | null;

  // Momentum
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;

  // Volatility
  atr14: number | null;
  bollingerUpper: number | null;
  bollingerLower: number | null;
  bollingerMid: number | null;

  // VIX
  vix: number | null;

  // Derived signals
  trendDirection: 'UP' | 'DOWN' | 'SIDEWAYS';
  momentumSignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  volatilityRegime: 'LOW' | 'NORMAL' | 'HIGH';
}

interface IndicatorDayData {
  date: string;
  symbol: string;
  interval: '5m';
  vixClose: number | null;
  bars: IndicatorBar[];
  summary: {
    openPrice: number;
    closePrice: number;
    dayHigh: number;
    dayLow: number;
    dayChange: number;
    dayChangePct: number;
    avgRsi: number | null;
    finalMacd: number | null;
    finalTrend: string;
  };
}

// Load VIX data into a lookup map
function loadVixData(): Map<string, number> {
  const vixMap = new Map<string, number>();
  try {
    const vixData = JSON.parse(fs.readFileSync(VIX_PATH, 'utf-8'));
    for (const record of vixData.data) {
      vixMap.set(record.date, record.close);
    }
  } catch (error) {
    console.error('Warning: Could not load VIX data:', error);
  }
  return vixMap;
}

// Simple Moving Average
function sma(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// Exponential Moving Average
function ema(prices: number[], period: number, prevEma?: number): number | null {
  if (prices.length < period) return null;

  const multiplier = 2 / (period + 1);

  if (prevEma === undefined) {
    // Initialize with SMA
    return sma(prices.slice(-period), period);
  }

  const currentPrice = prices[prices.length - 1];
  return (currentPrice - prevEma) * multiplier + prevEma;
}

// RSI (Relative Strength Index)
function rsi(prices: number[], period: number = 14): number | null {
  if (prices.length < period + 1) return null;

  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  if (changes.length < period) return null;

  const recentChanges = changes.slice(-period);
  let gains = 0;
  let losses = 0;

  for (const change of recentChanges) {
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// MACD (Moving Average Convergence Divergence)
function macd(prices: number[], ema12: number | null, ema26: number | null, signalEma: number | null): {
  macd: number | null;
  signal: number | null;
  histogram: number | null;
} {
  if (ema12 === null || ema26 === null) {
    return { macd: null, signal: null, histogram: null };
  }

  const macdValue = ema12 - ema26;
  const signal = signalEma;
  const histogram = signal !== null ? macdValue - signal : null;

  return { macd: macdValue, signal, histogram };
}

// Average True Range
function atr(bars: UnderlyingBar[], period: number = 14): number | null {
  if (bars.length < period + 1) return null;

  const trueRanges: number[] = [];

  for (let i = 1; i < bars.length; i++) {
    const high = bars[i].high;
    const low = bars[i].low;
    const prevClose = bars[i - 1].close;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trueRanges.push(tr);
  }

  if (trueRanges.length < period) return null;

  const recentTR = trueRanges.slice(-period);
  return recentTR.reduce((a, b) => a + b, 0) / period;
}

// Bollinger Bands
function bollingerBands(prices: number[], period: number = 20, stdDev: number = 2): {
  upper: number | null;
  mid: number | null;
  lower: number | null;
} {
  if (prices.length < period) {
    return { upper: null, mid: null, lower: null };
  }

  const slice = prices.slice(-period);
  const mid = slice.reduce((a, b) => a + b, 0) / period;

  const variance = slice.reduce((sum, p) => sum + Math.pow(p - mid, 2), 0) / period;
  const std = Math.sqrt(variance);

  return {
    upper: mid + stdDev * std,
    mid,
    lower: mid - stdDev * std
  };
}

// Determine trend direction
function getTrendDirection(price: number, sma20: number | null, sma50: number | null): 'UP' | 'DOWN' | 'SIDEWAYS' {
  if (sma20 === null || sma50 === null) return 'SIDEWAYS';

  const aboveSma20 = price > sma20;
  const aboveSma50 = price > sma50;
  const sma20AboveSma50 = sma20 > sma50;

  if (aboveSma20 && aboveSma50 && sma20AboveSma50) return 'UP';
  if (!aboveSma20 && !aboveSma50 && !sma20AboveSma50) return 'DOWN';
  return 'SIDEWAYS';
}

// Determine momentum signal
function getMomentumSignal(rsiVal: number | null, macdHist: number | null): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  if (rsiVal === null) return 'NEUTRAL';

  const rsiBullish = rsiVal > 50 && rsiVal < 70;
  const rsiBearish = rsiVal < 50 && rsiVal > 30;
  const rsiOverbought = rsiVal >= 70;
  const rsiOversold = rsiVal <= 30;

  const macdBullish = macdHist !== null && macdHist > 0;
  const macdBearish = macdHist !== null && macdHist < 0;

  if (rsiOverbought || (rsiBearish && macdBearish)) return 'BEARISH';
  if (rsiOversold || (rsiBullish && macdBullish)) return 'BULLISH';
  return 'NEUTRAL';
}

// Determine volatility regime based on VIX
function getVolatilityRegime(vix: number | null): 'LOW' | 'NORMAL' | 'HIGH' {
  if (vix === null) return 'NORMAL';
  if (vix < 15) return 'LOW';
  if (vix > 25) return 'HIGH';
  return 'NORMAL';
}

function processDay(inputPath: string, outputPath: string, vix: number | null): { success: boolean; bars: number } {
  try {
    const rawData: ProcessedDayData = JSON.parse(fs.readFileSync(inputPath, 'utf-8'));
    const bars = rawData.underlyingBars;

    if (bars.length === 0) {
      return { success: false, bars: 0 };
    }

    // Collect all prices for historical calculations
    const closePrices: number[] = [];
    const indicatorBars: IndicatorBar[] = [];

    // Track EMAs across bars
    let prevEma9: number | undefined;
    let prevEma21: number | undefined;
    let prevEma12: number | undefined;
    let prevEma26: number | undefined;
    let prevSignalEma: number | undefined;

    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i];
      closePrices.push(bar.close);

      // Calculate EMAs
      const ema9Val = ema(closePrices, 9, prevEma9);
      const ema21Val = ema(closePrices, 21, prevEma21);
      const ema12Val = ema(closePrices, 12, prevEma12);
      const ema26Val = ema(closePrices, 26, prevEma26);

      prevEma9 = ema9Val ?? prevEma9;
      prevEma21 = ema21Val ?? prevEma21;
      prevEma12 = ema12Val ?? prevEma12;
      prevEma26 = ema26Val ?? prevEma26;

      // Calculate MACD
      let macdVal = null;
      let signalVal = null;
      let histogramVal = null;

      if (ema12Val !== null && ema26Val !== null) {
        macdVal = ema12Val - ema26Val;

        // Build MACD history for signal line
        if (i >= 25) { // Need 26 bars for ema26
          const macdHistory = [];
          // Recalculate MACD history for signal EMA
          let tempEma12: number | undefined;
          let tempEma26: number | undefined;
          for (let j = 0; j <= i; j++) {
            const prices = closePrices.slice(0, j + 1);
            const e12 = ema(prices, 12, tempEma12);
            const e26 = ema(prices, 26, tempEma26);
            tempEma12 = e12 ?? tempEma12;
            tempEma26 = e26 ?? tempEma26;
            if (e12 !== null && e26 !== null) {
              macdHistory.push(e12 - e26);
            }
          }

          if (macdHistory.length >= 9) {
            signalVal = ema(macdHistory, 9, prevSignalEma);
            prevSignalEma = signalVal ?? prevSignalEma;
            if (signalVal !== null && macdVal !== null) {
              histogramVal = macdVal - signalVal;
            }
          }
        }
      }

      // Other indicators
      const sma20Val = sma(closePrices, 20);
      const sma50Val = sma(closePrices, 50);
      const rsi14Val = rsi(closePrices, 14);
      const atr14Val = atr(bars.slice(0, i + 1), 14);
      const bb = bollingerBands(closePrices, 20, 2);

      // Derived signals
      const trend = getTrendDirection(bar.close, sma20Val, sma50Val);
      const momentum = getMomentumSignal(rsi14Val, histogramVal);
      const volRegime = getVolatilityRegime(vix);

      indicatorBars.push({
        timestamp: bar.timestamp,
        price: bar.close,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        sma20: sma20Val,
        sma50: sma50Val,
        ema9: ema9Val,
        ema21: ema21Val,
        rsi14: rsi14Val,
        macd: macdVal,
        macdSignal: signalVal,
        macdHistogram: histogramVal,
        atr14: atr14Val,
        bollingerUpper: bb.upper,
        bollingerLower: bb.lower,
        bollingerMid: bb.mid,
        vix,
        trendDirection: trend,
        momentumSignal: momentum,
        volatilityRegime: volRegime
      });
    }

    // Calculate summary
    const firstBar = bars[0];
    const lastBar = bars[bars.length - 1];
    const dayHigh = Math.max(...bars.map(b => b.high));
    const dayLow = Math.min(...bars.map(b => b.low));
    const dayChange = lastBar.close - firstBar.open;
    const dayChangePct = (dayChange / firstBar.open) * 100;

    const validRsi = indicatorBars.filter(b => b.rsi14 !== null).map(b => b.rsi14!);
    const avgRsi = validRsi.length > 0 ? validRsi.reduce((a, b) => a + b, 0) / validRsi.length : null;

    const lastIndicator = indicatorBars[indicatorBars.length - 1];

    const output: IndicatorDayData = {
      date: rawData.date,
      symbol: rawData.symbol,
      interval: '5m',
      vixClose: vix,
      bars: indicatorBars,
      summary: {
        openPrice: firstBar.open,
        closePrice: lastBar.close,
        dayHigh,
        dayLow,
        dayChange,
        dayChangePct,
        avgRsi,
        finalMacd: lastIndicator.macd,
        finalTrend: lastIndicator.trendDirection
      }
    };

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(output));

    return { success: true, bars: indicatorBars.length };
  } catch (error) {
    console.error(`Error processing ${inputPath}:`, error);
    return { success: false, bars: 0 };
  }
}

async function main() {
  const symbols = ['SPY', 'QQQ'];

  console.log('=' .repeat(70));
  console.log('COMPUTING TECHNICAL INDICATORS');
  console.log('=' .repeat(70));

  // Load VIX data
  console.log('\nLoading VIX data...');
  const vixData = loadVixData();
  console.log(`Loaded ${vixData.size} VIX daily records`);

  for (const symbol of symbols) {
    const symbolProcessedDir = path.join(PROCESSED_DIR, symbol);
    const symbolIndicatorsDir = path.join(INDICATORS_DIR, symbol);

    if (!fs.existsSync(symbolProcessedDir)) {
      console.log(`\n${symbol}: No processed data found, skipping`);
      continue;
    }

    const monthDirs = fs.readdirSync(symbolProcessedDir).filter(d =>
      fs.statSync(path.join(symbolProcessedDir, d)).isDirectory()
    ).sort();

    console.log(`\n${symbol}: Processing ${monthDirs.length} months...`);

    let totalDays = 0;
    let processedDays = 0;
    let totalBars = 0;

    for (const month of monthDirs) {
      const monthProcessedDir = path.join(symbolProcessedDir, month);
      const monthIndicatorsDir = path.join(symbolIndicatorsDir, month);

      const dayFiles = fs.readdirSync(monthProcessedDir)
        .filter(f => f.endsWith('.json'))
        .sort();

      for (const dayFile of dayFiles) {
        totalDays++;
        const inputPath = path.join(monthProcessedDir, dayFile);
        const outputPath = path.join(monthIndicatorsDir, dayFile);

        // Get date for VIX lookup (filename is YYYYMMDD.json)
        const dateStr = dayFile.replace('.json', '');
        const vix = vixData.get(dateStr) ?? null;

        const { success, bars } = processDay(inputPath, outputPath, vix);

        if (success) {
          processedDays++;
          totalBars += bars;
        }

        if (totalDays % 100 === 0) {
          console.log(`  Processed ${totalDays} days...`);
        }
      }
    }

    console.log(`\n${symbol} Complete:`);
    console.log(`  Days processed: ${processedDays}/${totalDays}`);
    console.log(`  Total indicator bars: ${totalBars.toLocaleString()}`);
    console.log(`  Avg bars/day: ${Math.round(totalBars / processedDays)}`);
  }

  console.log('\n' + '=' .repeat(70));
  console.log('INDICATOR COMPUTATION COMPLETE');
  console.log('=' .repeat(70));
  console.log(`\nIndicator data saved to: ${INDICATORS_DIR}`);
}

main().catch(console.error);
