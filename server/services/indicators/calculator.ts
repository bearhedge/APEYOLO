/**
 * Calculates technical indicators from price data
 * This is what the AI "sees" - your job is to teach it when to trust/ignore these
 */

export interface PriceBar {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorSnapshot {
  // Price
  price: number;

  // Trend
  sma20: number;
  sma50: number;
  ema9: number;
  ema21: number;

  // Momentum
  rsi14: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;

  // Volatility
  atr14: number;
  bollingerUpper: number;
  bollingerLower: number;

  // Derived
  trendDirection: 'UP' | 'DOWN' | 'SIDEWAYS';
  momentumSignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  volatilityRegime: 'LOW' | 'NORMAL' | 'HIGH';

  // Direction suggestion based on indicators only
  indicatorSuggestion: 'PUT' | 'CALL' | 'STRANGLE' | 'NO_TRADE';
  indicatorConfidence: number;
}

// Simple Moving Average
function sma(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// Exponential Moving Average
function ema(prices: number[], period: number): number {
  if (prices.length === 0) return 0;
  if (prices.length < period) return sma(prices, prices.length);
  const k = 2 / (period + 1);
  let emaValue = sma(prices.slice(0, period), period);
  for (let i = period; i < prices.length; i++) {
    emaValue = prices[i] * k + emaValue * (1 - k);
  }
  return emaValue;
}

// Relative Strength Index
function rsi(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;

  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

// Average True Range
function atr(bars: PriceBar[], period: number = 14): number {
  if (bars.length < period + 1) return 0;

  const trueRanges: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close)
    );
    trueRanges.push(tr);
  }

  return sma(trueRanges.slice(-period), period);
}

// MACD
function macd(prices: number[]): { macd: number; signal: number; histogram: number } {
  const ema12 = ema(prices, 12);
  const ema26 = ema(prices, 26);
  const macdLine = ema12 - ema26;

  // For proper MACD signal, we'd need historical MACD values
  // Simplified: use 90% approximation
  const signal = macdLine * 0.9;

  return {
    macd: macdLine,
    signal,
    histogram: macdLine - signal,
  };
}

// Bollinger Bands
function bollingerBands(prices: number[], period: number = 20): { upper: number; lower: number } {
  const middle = sma(prices, period);
  const slice = prices.slice(-period);
  if (slice.length === 0) return { upper: 0, lower: 0 };
  const variance = slice.reduce((sum, p) => sum + Math.pow(p - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);

  return {
    upper: middle + 2 * stdDev,
    lower: middle - 2 * stdDev,
  };
}

export function calculateIndicators(bars: PriceBar[], vix?: number): IndicatorSnapshot {
  if (bars.length === 0) {
    throw new Error('No price bars provided');
  }

  const closes = bars.map(b => b.close);
  const price = closes[closes.length - 1];

  const sma20Val = sma(closes, 20);
  const sma50Val = sma(closes, 50);
  const ema9Val = ema(closes, 9);
  const ema21Val = ema(closes, 21);
  const rsi14Val = rsi(closes, 14);
  const macdResult = macd(closes);
  const atr14Val = atr(bars, 14);
  const bb = bollingerBands(closes, 20);

  // Derive trend direction
  let trendDirection: 'UP' | 'DOWN' | 'SIDEWAYS';
  if (price > sma20Val && sma20Val > sma50Val) trendDirection = 'UP';
  else if (price < sma20Val && sma20Val < sma50Val) trendDirection = 'DOWN';
  else trendDirection = 'SIDEWAYS';

  // Derive momentum signal
  let momentumSignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  if (rsi14Val > 60 && macdResult.histogram > 0) momentumSignal = 'BULLISH';
  else if (rsi14Val < 40 && macdResult.histogram < 0) momentumSignal = 'BEARISH';
  else momentumSignal = 'NEUTRAL';

  // Derive volatility regime
  const atrPercent = price > 0 ? (atr14Val / price) * 100 : 0;
  let volatilityRegime: 'LOW' | 'NORMAL' | 'HIGH';
  if (vix && vix > 25) volatilityRegime = 'HIGH';
  else if (vix && vix < 15) volatilityRegime = 'LOW';
  else if (atrPercent > 2) volatilityRegime = 'HIGH';
  else if (atrPercent < 0.8) volatilityRegime = 'LOW';
  else volatilityRegime = 'NORMAL';

  // Derive indicator-based direction suggestion
  let indicatorSuggestion: 'PUT' | 'CALL' | 'STRANGLE' | 'NO_TRADE';
  let indicatorConfidence: number;

  if (volatilityRegime === 'HIGH') {
    indicatorSuggestion = 'NO_TRADE';
    indicatorConfidence = 0.3;
  } else if (trendDirection === 'SIDEWAYS') {
    indicatorSuggestion = 'STRANGLE';
    indicatorConfidence = 0.6;
  } else if (trendDirection === 'UP' && momentumSignal === 'BULLISH') {
    indicatorSuggestion = 'PUT'; // Sell puts in uptrend
    indicatorConfidence = 0.7;
  } else if (trendDirection === 'DOWN' && momentumSignal === 'BEARISH') {
    indicatorSuggestion = 'CALL'; // Sell calls in downtrend
    indicatorConfidence = 0.7;
  } else {
    indicatorSuggestion = 'STRANGLE';
    indicatorConfidence = 0.5;
  }

  return {
    price,
    sma20: sma20Val,
    sma50: sma50Val,
    ema9: ema9Val,
    ema21: ema21Val,
    rsi14: rsi14Val,
    macd: macdResult.macd,
    macdSignal: macdResult.signal,
    macdHistogram: macdResult.histogram,
    atr14: atr14Val,
    bollingerUpper: bb.upper,
    bollingerLower: bb.lower,
    trendDirection,
    momentumSignal,
    volatilityRegime,
    indicatorSuggestion,
    indicatorConfidence,
  };
}
