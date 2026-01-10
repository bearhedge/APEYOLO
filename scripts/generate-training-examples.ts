#!/usr/bin/env npx tsx
/**
 * Generates RLHF training examples from processed options data
 *
 * For each trading day:
 * 1. Captures 11 AM snapshot (market conditions at decision time)
 * 2. Calculates actual outcome by 4 PM (the label)
 * 3. Determines optimal direction based on price movement
 * 4. Computes efficiency score based on what was theoretically achievable
 *
 * Labeling Logic (for selling premium):
 * - SPY up >0.5%   → PUT was optimal (sell puts, they expire worthless)
 * - SPY down >0.5% → CALL was optimal (sell calls, they expire worthless)
 * - SPY ±0.5%      → STRANGLE was optimal (sideways, collect both)
 *
 * Output: data/theta/training/training_examples.jsonl
 */

import * as fs from 'fs';
import * as path from 'path';

const INDICATORS_DIR = '/Users/home/Desktop/APE YOLO/APE-YOLO/data/theta/indicators';
const PROCESSED_DIR = '/Users/home/Desktop/APE YOLO/APE-YOLO/data/theta/processed';
const TRAINING_DIR = '/Users/home/Desktop/APE YOLO/APE-YOLO/data/theta/training';

// Decision time and close time
const DECISION_TIME = '11:00:00';
const CLOSE_TIME = '15:55:00';

interface IndicatorBar {
  timestamp: string;
  price: number;
  open: number;
  high: number;
  low: number;
  sma20: number | null;
  sma50: number | null;
  ema9: number | null;
  ema21: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  atr14: number | null;
  bollingerUpper: number | null;
  bollingerLower: number | null;
  bollingerMid: number | null;
  vix: number | null;
  trendDirection: string;
  momentumSignal: string;
  volatilityRegime: string;
}

interface IndicatorDayData {
  date: string;
  symbol: string;
  interval: string;
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

interface OptionsSnapshot {
  atm_call: { strike: number; bid: number; ask: number; delta: number; iv: number } | null;
  atm_put: { strike: number; bid: number; ask: number; delta: number; iv: number } | null;
  otm_puts: { strike: number; bid: number; ask: number; delta: number; iv: number }[];
  otm_calls: { strike: number; bid: number; ask: number; delta: number; iv: number }[];
}

interface TrainingExample {
  id: string;
  date: string;
  symbol: string;
  snapshotTime: string;

  // Price at decision time
  underlyingPrice: number;
  vix: number | null;

  // Technical indicators at decision time
  indicators: {
    sma20: number | null;
    sma50: number | null;
    ema9: number | null;
    ema21: number | null;
    rsi14: number | null;
    macd: number | null;
    macdSignal: number | null;
    macdHistogram: number | null;
    atr14: number | null;
    bollingerUpper: number | null;
    bollingerLower: number | null;
    trendDirection: string;
    momentumSignal: string;
    volatilityRegime: string;
  };

  // Recent price action (last N bars before decision)
  recentBars: { timestamp: string; open: number; high: number; low: number; close: number }[];

  // Actual outcome (what happened)
  closePrice: number;
  priceChange: number;
  priceChangePct: number;
  intradayHigh: number;
  intradayLow: number;
  maxDrawdown: number;
  maxRunup: number;

  // Labeling (optimal direction given outcome)
  optimalDirection: 'PUT' | 'CALL' | 'STRANGLE' | 'NO_TRADE';
  conviction: 'STRONG' | 'MEDIUM' | 'WEAK';

  // Options context (if available)
  optionsSnapshot: OptionsSnapshot | null;

  // Efficiency scoring
  theoreticalMaxPnl: number;
  efficiencyBand: 'HIGH' | 'MEDIUM' | 'LOW';
}

function getBarAtTime(bars: IndicatorBar[], targetTime: string): IndicatorBar | null {
  // Find bar at or just before target time
  const targetHour = parseInt(targetTime.split(':')[0]);
  const targetMin = parseInt(targetTime.split(':')[1]);
  const targetMinutes = targetHour * 60 + targetMin;

  let closestBar: IndicatorBar | null = null;
  let closestDiff = Infinity;

  for (const bar of bars) {
    const barTime = bar.timestamp.split('T')[1];
    const barHour = parseInt(barTime.split(':')[0]);
    const barMin = parseInt(barTime.split(':')[1]);
    const barMinutes = barHour * 60 + barMin;

    const diff = targetMinutes - barMinutes;
    if (diff >= 0 && diff < closestDiff) {
      closestDiff = diff;
      closestBar = bar;
    }
  }

  return closestBar;
}

function getOptimalDirection(changePct: number): { direction: 'PUT' | 'CALL' | 'STRANGLE' | 'NO_TRADE'; conviction: 'STRONG' | 'MEDIUM' | 'WEAK' } {
  const absChange = Math.abs(changePct);

  // Thresholds for direction (selling premium strategy)
  // If market goes UP, selling puts was correct
  // If market goes DOWN, selling calls was correct
  // If market stays flat, strangle was correct

  if (absChange < 0.15) {
    // Very flat - strangle was perfect
    return { direction: 'STRANGLE', conviction: 'STRONG' };
  }

  if (absChange < 0.5) {
    // Slightly directional - strangle still works
    return { direction: 'STRANGLE', conviction: 'MEDIUM' };
  }

  // Directional move
  if (changePct > 0) {
    // Market went up - selling puts was correct
    if (changePct >= 1.0) {
      return { direction: 'PUT', conviction: 'STRONG' };
    } else {
      return { direction: 'PUT', conviction: 'MEDIUM' };
    }
  } else {
    // Market went down - selling calls was correct
    if (changePct <= -1.0) {
      return { direction: 'CALL', conviction: 'STRONG' };
    } else {
      return { direction: 'CALL', conviction: 'MEDIUM' };
    }
  }
}

function calculateTheoreticalMaxPnl(
  direction: 'PUT' | 'CALL' | 'STRANGLE',
  entryPrice: number,
  atr: number | null,
  vix: number | null
): number {
  // Estimate theoretical max P&L based on:
  // - ATR gives us expected move
  // - VIX gives us implied volatility (premium level)
  // - Direction tells us the trade type

  // Base premium estimate: ~0.5-1.5% of underlying depending on delta
  // For 0.30 delta options, roughly 0.8% premium
  const basePremiumPct = 0.008;

  // Scale by VIX (higher VIX = higher premium)
  const vixMultiplier = vix ? (vix / 20) : 1.0; // Normalize around VIX 20

  // Premium collected (per contract, $100 multiplier)
  const premiumPct = basePremiumPct * vixMultiplier;
  const premiumPerContract = entryPrice * premiumPct * 100;

  // For strangle, double the contracts
  const contractMultiplier = direction === 'STRANGLE' ? 2 : 1;

  return premiumPerContract * contractMultiplier;
}

function getEfficiencyBand(actualOutcome: number, optimalDirection: string, changePct: number): 'HIGH' | 'MEDIUM' | 'LOW' {
  const absChange = Math.abs(changePct);

  // High efficiency: Direction was strongly confirmed
  // - PUT with market up >0.5%
  // - CALL with market down >0.5%
  // - STRANGLE with market flat <0.3%

  if (optimalDirection === 'STRANGLE') {
    if (absChange < 0.3) return 'HIGH';
    if (absChange < 0.5) return 'MEDIUM';
    return 'LOW';
  }

  if (optimalDirection === 'PUT' && changePct > 0) {
    if (changePct > 0.8) return 'HIGH';
    if (changePct > 0.4) return 'MEDIUM';
    return 'LOW';
  }

  if (optimalDirection === 'CALL' && changePct < 0) {
    if (changePct < -0.8) return 'HIGH';
    if (changePct < -0.4) return 'MEDIUM';
    return 'LOW';
  }

  return 'LOW';
}

function loadOptionsSnapshot(processedDir: string, symbol: string, date: string): OptionsSnapshot | null {
  try {
    const monthDir = date.substring(0, 6);
    const filePath = path.join(processedDir, symbol, monthDir, `${date}.json`);

    if (!fs.existsSync(filePath)) return null;

    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const greeks = data.greeks || [];
    const quotes = data.quotes || [];

    if (greeks.length === 0) return null;

    // Find 11 AM options snapshot
    // Get underlying price at 11 AM from underlyingBars
    const bar11am = data.underlyingBars?.find((b: any) => b.timestamp.includes('11:00'));
    if (!bar11am) return null;

    const spotPrice = bar11am.close;

    // Filter greeks/quotes for near-11AM timestamps
    const nearTime = greeks.filter((g: any) =>
      g.timestamp.includes('11:0') || g.timestamp.includes('10:5')
    );

    if (nearTime.length === 0) return null;

    // Find ATM strike
    const strikes = [...new Set(nearTime.map((g: any) => g.strike))].sort((a, b) => a - b);
    const atmStrike = strikes.reduce((prev, curr) =>
      Math.abs(curr - spotPrice) < Math.abs(prev - spotPrice) ? curr : prev
    );

    // Build options snapshot
    const atmCall = nearTime.find((g: any) => g.strike === atmStrike && g.right === 'C');
    const atmPut = nearTime.find((g: any) => g.strike === atmStrike && g.right === 'P');

    // Get OTM options (within 2% of spot)
    const otmPuts = nearTime
      .filter((g: any) => g.right === 'P' && g.strike < spotPrice && g.strike > spotPrice * 0.98)
      .map((g: any) => ({
        strike: g.strike,
        bid: g.bid,
        ask: g.ask,
        delta: g.delta,
        iv: g.iv
      }));

    const otmCalls = nearTime
      .filter((g: any) => g.right === 'C' && g.strike > spotPrice && g.strike < spotPrice * 1.02)
      .map((g: any) => ({
        strike: g.strike,
        bid: g.bid,
        ask: g.ask,
        delta: g.delta,
        iv: g.iv
      }));

    return {
      atm_call: atmCall ? { strike: atmCall.strike, bid: atmCall.bid, ask: atmCall.ask, delta: atmCall.delta, iv: atmCall.iv } : null,
      atm_put: atmPut ? { strike: atmPut.strike, bid: atmPut.bid, ask: atmPut.ask, delta: atmPut.delta, iv: atmPut.iv } : null,
      otm_puts: otmPuts.slice(0, 5),
      otm_calls: otmCalls.slice(0, 5)
    };
  } catch (error) {
    return null;
  }
}

function processDay(indicatorPath: string, symbol: string, date: string): TrainingExample | null {
  try {
    const data: IndicatorDayData = JSON.parse(fs.readFileSync(indicatorPath, 'utf-8'));
    const bars = data.bars;

    if (bars.length < 50) {
      // Not enough bars for reliable indicators
      return null;
    }

    // Get 11 AM bar
    const decisionBar = getBarAtTime(bars, DECISION_TIME);
    if (!decisionBar) return null;

    // Get close bar (3:55 PM or last available)
    const closeBar = getBarAtTime(bars, CLOSE_TIME) || bars[bars.length - 1];
    if (!closeBar) return null;

    // Calculate outcome
    const entryPrice = decisionBar.price;
    const closePrice = closeBar.price;
    const priceChange = closePrice - entryPrice;
    const priceChangePct = (priceChange / entryPrice) * 100;

    // Find intraday high/low after decision time
    const decisionIdx = bars.findIndex(b => b.timestamp === decisionBar.timestamp);
    const afterDecisionBars = bars.slice(decisionIdx);

    const intradayHigh = Math.max(...afterDecisionBars.map(b => b.high));
    const intradayLow = Math.min(...afterDecisionBars.map(b => b.low));
    const maxRunup = ((intradayHigh - entryPrice) / entryPrice) * 100;
    const maxDrawdown = ((intradayLow - entryPrice) / entryPrice) * 100;

    // Get recent bars before decision (last 10 bars = 50 minutes)
    const recentBars = bars.slice(Math.max(0, decisionIdx - 10), decisionIdx).map(b => ({
      timestamp: b.timestamp,
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.price
    }));

    // Determine optimal direction
    const { direction, conviction } = getOptimalDirection(priceChangePct);

    // Calculate theoretical max P&L
    const theoreticalMaxPnl = calculateTheoreticalMaxPnl(
      direction,
      entryPrice,
      decisionBar.atr14,
      decisionBar.vix
    );

    // Get efficiency band
    const efficiencyBand = getEfficiencyBand(priceChange, direction, priceChangePct);

    // Try to load options snapshot
    const optionsSnapshot = loadOptionsSnapshot(PROCESSED_DIR, symbol, date);

    const example: TrainingExample = {
      id: `${symbol}-${date}-${DECISION_TIME.replace(/:/g, '')}`,
      date,
      symbol,
      snapshotTime: DECISION_TIME,

      underlyingPrice: entryPrice,
      vix: decisionBar.vix,

      indicators: {
        sma20: decisionBar.sma20,
        sma50: decisionBar.sma50,
        ema9: decisionBar.ema9,
        ema21: decisionBar.ema21,
        rsi14: decisionBar.rsi14,
        macd: decisionBar.macd,
        macdSignal: decisionBar.macdSignal,
        macdHistogram: decisionBar.macdHistogram,
        atr14: decisionBar.atr14,
        bollingerUpper: decisionBar.bollingerUpper,
        bollingerLower: decisionBar.bollingerLower,
        trendDirection: decisionBar.trendDirection,
        momentumSignal: decisionBar.momentumSignal,
        volatilityRegime: decisionBar.volatilityRegime
      },

      recentBars,

      closePrice,
      priceChange,
      priceChangePct,
      intradayHigh,
      intradayLow,
      maxDrawdown,
      maxRunup,

      optimalDirection: direction,
      conviction,

      optionsSnapshot,

      theoreticalMaxPnl,
      efficiencyBand
    };

    return example;
  } catch (error) {
    console.error(`Error processing ${indicatorPath}:`, error);
    return null;
  }
}

async function main() {
  const symbols = ['SPY', 'QQQ'];

  console.log('=' .repeat(70));
  console.log('GENERATING TRAINING EXAMPLES');
  console.log('=' .repeat(70));

  // Ensure output directory exists
  if (!fs.existsSync(TRAINING_DIR)) {
    fs.mkdirSync(TRAINING_DIR, { recursive: true });
  }

  const outputPath = path.join(TRAINING_DIR, 'training_examples.jsonl');
  const outputStream = fs.createWriteStream(outputPath);

  let totalExamples = 0;
  const stats = {
    PUT: 0,
    CALL: 0,
    STRANGLE: 0,
    NO_TRADE: 0,
    STRONG: 0,
    MEDIUM: 0,
    WEAK: 0,
    HIGH_EFF: 0,
    MEDIUM_EFF: 0,
    LOW_EFF: 0
  };

  for (const symbol of symbols) {
    const symbolDir = path.join(INDICATORS_DIR, symbol);

    if (!fs.existsSync(symbolDir)) {
      console.log(`\n${symbol}: No indicator data found, skipping`);
      continue;
    }

    const monthDirs = fs.readdirSync(symbolDir).filter(d =>
      fs.statSync(path.join(symbolDir, d)).isDirectory()
    ).sort();

    console.log(`\n${symbol}: Processing ${monthDirs.length} months...`);

    let symbolExamples = 0;

    for (const month of monthDirs) {
      const monthDir = path.join(symbolDir, month);
      const dayFiles = fs.readdirSync(monthDir)
        .filter(f => f.endsWith('.json'))
        .sort();

      for (const dayFile of dayFiles) {
        const date = dayFile.replace('.json', '');
        const indicatorPath = path.join(monthDir, dayFile);

        const example = processDay(indicatorPath, symbol, date);

        if (example) {
          outputStream.write(JSON.stringify(example) + '\n');
          totalExamples++;
          symbolExamples++;

          // Update stats
          stats[example.optimalDirection]++;
          stats[example.conviction]++;
          stats[`${example.efficiencyBand}_EFF` as keyof typeof stats]++;
        }

        if ((symbolExamples % 100) === 0 && symbolExamples > 0) {
          console.log(`  Generated ${symbolExamples} examples...`);
        }
      }
    }

    console.log(`\n${symbol} Complete: ${symbolExamples} examples generated`);
  }

  outputStream.end();

  console.log('\n' + '=' .repeat(70));
  console.log('TRAINING EXAMPLE GENERATION COMPLETE');
  console.log('=' .repeat(70));

  console.log(`\nTotal examples: ${totalExamples}`);
  console.log(`\nDirection distribution:`);
  console.log(`  PUT: ${stats.PUT} (${(stats.PUT / totalExamples * 100).toFixed(1)}%)`);
  console.log(`  CALL: ${stats.CALL} (${(stats.CALL / totalExamples * 100).toFixed(1)}%)`);
  console.log(`  STRANGLE: ${stats.STRANGLE} (${(stats.STRANGLE / totalExamples * 100).toFixed(1)}%)`);

  console.log(`\nConviction distribution:`);
  console.log(`  STRONG: ${stats.STRONG} (${(stats.STRONG / totalExamples * 100).toFixed(1)}%)`);
  console.log(`  MEDIUM: ${stats.MEDIUM} (${(stats.MEDIUM / totalExamples * 100).toFixed(1)}%)`);
  console.log(`  WEAK: ${stats.WEAK} (${(stats.WEAK / totalExamples * 100).toFixed(1)}%)`);

  console.log(`\nEfficiency distribution:`);
  console.log(`  HIGH: ${stats.HIGH_EFF} (${(stats.HIGH_EFF / totalExamples * 100).toFixed(1)}%)`);
  console.log(`  MEDIUM: ${stats.MEDIUM_EFF} (${(stats.MEDIUM_EFF / totalExamples * 100).toFixed(1)}%)`);
  console.log(`  LOW: ${stats.LOW_EFF} (${(stats.LOW_EFF / totalExamples * 100).toFixed(1)}%)`);

  console.log(`\nOutput saved to: ${outputPath}`);
}

main().catch(console.error);
