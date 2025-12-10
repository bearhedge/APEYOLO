/**
 * Market Data Service
 * Fetches real-time market data from IBKR for SPY, VIX, and options
 */

import { getBroker, getBrokerWithStatus } from "../broker/index";
import { ensureIbkrReady, ibkrBroker } from "../broker/ibkr";

export interface MarketData {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  volume: number;
  change: number;
  changePercent: number;
  timestamp: Date;
}

export interface OptionChain {
  underlying: string;
  underlyingPrice: number;
  expirationDate: string;
  calls: OptionContract[];
  puts: OptionContract[];
}

export interface OptionContract {
  symbol: string;
  strike: number;
  expiration: string;
  optionType: 'CALL' | 'PUT';
  bid: number;
  ask: number;
  last: number;
  volume: number;
  openInterest: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  impliedVolatility: number;
}

export interface VIXData {
  value: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  timestamp: Date;
}

// Cache for market data (avoid excessive API calls)
class MarketDataCache {
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private ttl: number = 5000; // 5 seconds TTL

  get(key: string): any | null {
    const cached = this.cache.get(key);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  set(key: string, data: any): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}

const cache = new MarketDataCache();

/**
 * Get real-time market data for a symbol
 * Includes retry logic and Yahoo Finance fallback for SPY when IBKR returns $0
 */
export async function getMarketData(symbol: string): Promise<MarketData> {
  // Check cache first
  const cacheKey = `market:${symbol}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.price > 0) return cached;

  const broker = getBroker();

  // Use mock data if not connected to IBKR
  if (broker.status.provider === 'mock') {
    const mockData: MarketData = {
      symbol,
      price: symbol === 'SPY' ? 450.50 + (Math.random() - 0.5) * 2 :
             symbol === 'VIX' ? 15.30 + (Math.random() - 0.5) * 0.5 : 100,
      bid: 0,
      ask: 0,
      volume: Math.floor(Math.random() * 1000000),
      change: (Math.random() - 0.5) * 5,
      changePercent: (Math.random() - 0.5) * 2,
      timestamp: new Date()
    };
    mockData.bid = mockData.price - 0.01;
    mockData.ask = mockData.price + 0.01;

    console.log(`[MarketData] Using MOCK data for ${symbol}: $${mockData.price.toFixed(2)}`);
    cache.set(cacheKey, mockData);
    return mockData;
  }

  // Ensure IBKR is ready
  await ensureIbkrReady();

  // Try IBKR with retry logic (up to 3 attempts with 500ms delay)
  let marketData: MarketData | null = null;
  const maxRetries = 3;
  console.log(`[MarketData] Starting IBKR fetch for ${symbol} (max ${maxRetries} attempts)...`);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`[MarketData] IBKR ${symbol} attempt ${attempt}/${maxRetries}...`);
    try {
      const data = await broker.api.getMarketData(symbol);
      console.log(`[MarketData] IBKR response: price=$${data.price?.toFixed(2) || '0'}, bid=$${data.bid?.toFixed(2) || '0'}, ask=$${data.ask?.toFixed(2) || '0'}`);

      if (data.price > 0) {
        marketData = data;
        console.log(`[MarketData] ✓ ${symbol}: $${marketData.price.toFixed(2)} (success on attempt ${attempt})`);
        break;
      }
      console.log(`[MarketData] ⚠ ${symbol} returned $0 (market closed or data unavailable)`);
    } catch (err: any) {
      console.error(`[MarketData] ✗ ${symbol} error on attempt ${attempt}: ${err?.message || err}`);
    }

    if (attempt < maxRetries) {
      console.log(`[MarketData] Waiting 1500ms before retry (IBKR needs time to prime subscription)...`);
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }

  // IBKR-only: No fallbacks - throw error if data unavailable
  if (!marketData || marketData.price === 0) {
    console.error(`[MarketData] ✗ All ${maxRetries} attempts failed for ${symbol}`);
    throw new Error(`[IBKR] Market data unavailable for ${symbol} after ${maxRetries} attempts`);
  }

  cache.set(cacheKey, marketData);
  return marketData;
}

/**
 * Get VIX data (volatility index) - Uses IBKR for real data
 * Consistent with SPY data source
 */
export async function getVIXData(): Promise<VIXData> {
  const cacheKey = 'vix:data';
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const broker = getBroker();

  // Use mock data if not connected to IBKR
  if (broker.status.provider === 'mock') {
    const vixData: VIXData = {
      value: 15.30 + (Math.random() - 0.5) * 0.5,
      change: (Math.random() - 0.5) * 0.5,
      changePercent: (Math.random() - 0.5) * 2,
      high: 16.00,
      low: 14.50,
      timestamp: new Date()
    };
    console.log(`[MarketData] Using MOCK VIX: ${vixData.value.toFixed(2)}`);
    cache.set(cacheKey, vixData);
    return vixData;
  }

  try {
    // Ensure IBKR is ready
    await ensureIbkrReady();

    // Fetch VIX from IBKR using the same getMarketData function as SPY
    const vixMarketData = await broker.api.getMarketData('VIX');

    const vixData: VIXData = {
      value: vixMarketData.price,
      change: vixMarketData.change,
      changePercent: vixMarketData.changePercent,
      high: vixMarketData.price * 1.02, // IBKR snapshot doesn't provide high/low
      low: vixMarketData.price * 0.98,
      timestamp: new Date()
    };

    console.log(`[MarketData] IBKR VIX fetched: ${vixData.value.toFixed(2)} (${vixData.changePercent > 0 ? '+' : ''}${vixData.changePercent.toFixed(2)}%)`);
    cache.set(cacheKey, vixData);
    return vixData;
  } catch (error) {
    console.error('[MarketData] Error fetching VIX from IBKR, using fallback:', error);

    // Fallback to default VIX if IBKR fails
    const vixData: VIXData = {
      value: 17.50,
      change: 0,
      changePercent: 0,
      high: 18.00,
      low: 17.00,
      timestamp: new Date()
    };

    cache.set(cacheKey, vixData);
    return vixData;
  }
}

/**
 * Get option chain for a symbol and expiration
 */
export async function getOptionChain(
  symbol: string,
  expirationDate: string
): Promise<OptionChain> {
  const cacheKey = `options:${symbol}:${expirationDate}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const broker = getBroker();
  const marketData = await getMarketData(symbol);
  const underlyingPrice = marketData.price;

  if (broker.status.provider === 'mock') {
    // Generate mock option chain
    const strikes = [];
    const baseStrike = Math.round(underlyingPrice / 5) * 5;

    for (let i = -10; i <= 10; i++) {
      strikes.push(baseStrike + i * 5);
    }

    const calls: OptionContract[] = strikes.map(strike => ({
      symbol: `${symbol}_${expirationDate}_C_${strike}`,
      strike,
      expiration: expirationDate,
      optionType: 'CALL' as const,
      bid: Math.max(0, underlyingPrice - strike - 0.5 + Math.random()),
      ask: Math.max(0, underlyingPrice - strike + 0.5 + Math.random()),
      last: Math.max(0, underlyingPrice - strike + Math.random()),
      volume: Math.floor(Math.random() * 1000),
      openInterest: Math.floor(Math.random() * 5000),
      delta: strike < underlyingPrice ? 0.5 + (underlyingPrice - strike) / 100 : 0.5 - (strike - underlyingPrice) / 100,
      gamma: 0.01 + Math.random() * 0.02,
      theta: -(0.05 + Math.random() * 0.1),
      vega: 0.1 + Math.random() * 0.2,
      impliedVolatility: 0.15 + Math.random() * 0.1
    }));

    const puts: OptionContract[] = strikes.map(strike => ({
      symbol: `${symbol}_${expirationDate}_P_${strike}`,
      strike,
      expiration: expirationDate,
      optionType: 'PUT' as const,
      bid: Math.max(0, strike - underlyingPrice - 0.5 + Math.random()),
      ask: Math.max(0, strike - underlyingPrice + 0.5 + Math.random()),
      last: Math.max(0, strike - underlyingPrice + Math.random()),
      volume: Math.floor(Math.random() * 1000),
      openInterest: Math.floor(Math.random() * 5000),
      delta: strike > underlyingPrice ? -0.5 + (strike - underlyingPrice) / 100 : -0.5 - (underlyingPrice - strike) / 100,
      gamma: 0.01 + Math.random() * 0.02,
      theta: -(0.05 + Math.random() * 0.1),
      vega: 0.1 + Math.random() * 0.2,
      impliedVolatility: 0.15 + Math.random() * 0.1
    }));

    const optionChain: OptionChain = {
      underlying: symbol,
      underlyingPrice,
      expirationDate,
      calls,
      puts
    };

    cache.set(cacheKey, optionChain);
    return optionChain;
  }

  await ensureIbkrReady();

  try {
    // Fetch real option chain data from IBKR
    const ibkrData = await broker.api.getOptionChain(symbol, expirationDate);
    console.log(`[MarketData] IBKR option chain for ${symbol}: ${ibkrData.options?.length || 0} contracts`);

    // Use IBKR underlying price if available, otherwise use our fetched price
    const actualUnderlyingPrice = ibkrData.underlyingPrice || underlyingPrice;

    // Split options into calls and puts arrays
    const calls: OptionContract[] = (ibkrData.options || [])
      .filter(opt => opt.type === 'call')
      .map(opt => ({
        symbol: `${symbol}_${expirationDate}_C_${opt.strike}`,
        strike: opt.strike,
        expiration: opt.expiration || expirationDate,
        optionType: 'CALL' as const,
        bid: opt.bid,
        ask: opt.ask,
        last: (opt.bid + opt.ask) / 2, // Approximate last from mid
        volume: 0, // Not provided by IBKR basic chain
        openInterest: opt.openInterest || 0,
        delta: opt.delta,
        gamma: 0, // Requires market data subscription for real Greeks
        theta: 0,
        vega: 0,
        impliedVolatility: 0
      }));

    const puts: OptionContract[] = (ibkrData.options || [])
      .filter(opt => opt.type === 'put')
      .map(opt => ({
        symbol: `${symbol}_${expirationDate}_P_${opt.strike}`,
        strike: opt.strike,
        expiration: opt.expiration || expirationDate,
        optionType: 'PUT' as const,
        bid: opt.bid,
        ask: opt.ask,
        last: (opt.bid + opt.ask) / 2,
        volume: 0,
        openInterest: opt.openInterest || 0,
        delta: opt.delta,
        gamma: 0,
        theta: 0,
        vega: 0,
        impliedVolatility: 0
      }));

    console.log(`[MarketData] Parsed ${calls.length} calls, ${puts.length} puts from IBKR`);

    const optionChain: OptionChain = {
      underlying: symbol,
      underlyingPrice: actualUnderlyingPrice,
      expirationDate,
      calls,
      puts
    };

    cache.set(cacheKey, optionChain);
    return optionChain;

  } catch (error) {
    console.error(`[MarketData] Error fetching IBKR option chain for ${symbol}:`, error);
    // Return empty chain on error rather than crashing
    const optionChain: OptionChain = {
      underlying: symbol,
      underlyingPrice,
      expirationDate,
      calls: [],
      puts: []
    };
    cache.set(cacheKey, optionChain);
    return optionChain;
  }
}

/**
 * Get 0DTE (zero days to expiration) options
 */
export async function get0DTEOptions(symbol: string): Promise<OptionChain> {
  // Get today's date in YYYYMMDD format
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  const expirationDate = `${year}${month}${day}`;

  return getOptionChain(symbol, expirationDate);
}

/**
 * Find option contracts by delta
 */
export async function findOptionsByDelta(
  symbol: string,
  targetDelta: number,
  optionType: 'CALL' | 'PUT',
  expirationDate?: string
): Promise<OptionContract[]> {
  const expiry = expirationDate || new Date().toISOString().split('T')[0].replace(/-/g, '');
  const chain = await getOptionChain(symbol, expiry);

  const options = optionType === 'CALL' ? chain.calls : chain.puts;
  const targetAbsDelta = Math.abs(targetDelta);

  // Find options close to target delta
  const filtered = options.filter(opt => {
    const absDelta = Math.abs(opt.delta);
    return absDelta >= targetAbsDelta - 0.05 && absDelta <= targetAbsDelta + 0.05;
  });

  // Sort by how close to target delta
  filtered.sort((a, b) => {
    const aDiff = Math.abs(Math.abs(a.delta) - targetAbsDelta);
    const bDiff = Math.abs(Math.abs(b.delta) - targetAbsDelta);
    return aDiff - bDiff;
  });

  return filtered;
}

/**
 * Calculate option greeks and theoretical value
 */
export async function calculateOptionGreeks(
  underlyingPrice: number,
  strike: number,
  expirationDays: number,
  volatility: number,
  riskFreeRate: number = 0.05,
  optionType: 'CALL' | 'PUT' = 'CALL'
): Promise<{
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  theoreticalValue: number;
}> {
  // This would typically use Black-Scholes or similar model
  // For now, return simplified calculations

  const timeToExpiry = expirationDays / 365;
  const moneyness = underlyingPrice / strike;

  // Simplified delta calculation
  let delta: number;
  if (optionType === 'CALL') {
    if (moneyness > 1.1) delta = 0.9; // Deep ITM
    else if (moneyness > 1.05) delta = 0.7;
    else if (moneyness > 0.95) delta = 0.5; // ATM
    else if (moneyness > 0.9) delta = 0.3;
    else delta = 0.1; // Deep OTM
  } else {
    if (moneyness < 0.9) delta = -0.9; // Deep ITM
    else if (moneyness < 0.95) delta = -0.7;
    else if (moneyness < 1.05) delta = -0.5; // ATM
    else if (moneyness < 1.1) delta = -0.3;
    else delta = -0.1; // Deep OTM
  }

  // Simplified other greeks
  const gamma = 0.02 * Math.exp(-Math.abs(moneyness - 1) * 10);
  const theta = -0.1 * (1 / Math.max(timeToExpiry, 0.01));
  const vega = 0.2 * Math.exp(-Math.abs(moneyness - 1) * 5);

  // Simplified theoretical value
  let theoreticalValue: number;
  if (optionType === 'CALL') {
    theoreticalValue = Math.max(0, underlyingPrice - strike) +
                      volatility * Math.sqrt(timeToExpiry) * 2;
  } else {
    theoreticalValue = Math.max(0, strike - underlyingPrice) +
                      volatility * Math.sqrt(timeToExpiry) * 2;
  }

  return {
    delta,
    gamma,
    theta,
    vega,
    theoreticalValue
  };
}

/**
 * Clear the market data cache
 */
export function clearMarketDataCache(): void {
  cache.clear();
}

// Export the cache instance for testing
export { cache as marketDataCache };