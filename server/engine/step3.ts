/**
 * Step 3: Strike Selection
 * Selects optimal strike prices based on delta targeting (0.15-0.20)
 *
 * Uses real IBKR option chain data when available, falls back to mock data
 */

import { TradeDirection } from './step2';
import { getOptionChainWithStrikes } from '../broker/ibkr';
import { getOptionChainStreamer, CachedOptionChain } from '../broker/optionChainStreamer';

export interface Strike {
  strike: number;
  expiration: Date;
  delta: number;
  bid: number;
  ask: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  openInterest?: number;
  impliedVolatility?: number;
}

export interface StrikeSelection {
  putStrike?: Strike;
  callStrike?: Strike;
  expectedPremium: number;
  marginRequired: number;
  reasoning: string;
  nearbyStrikes?: {
    puts: Array<{ strike: number; bid: number; ask: number; delta: number; oi?: number }>;
    calls: Array<{ strike: number; bid: number; ask: number; delta: number; oi?: number }>;
  };
}

/**
 * Target delta range for option selection
 * 0.15-0.20 provides ~80-85% probability of expiring worthless
 */
const TARGET_DELTA_MIN = 0.15;
const TARGET_DELTA_MAX = 0.20;
const TARGET_DELTA_IDEAL = 0.18;

/**
 * Generate mock option chain for testing
 * In production, this will fetch from IBKR
 * @param underlyingPrice - Current price of underlying (e.g., SPY)
 * @param direction - PUT or CALL
 * @returns Array of available strikes
 */
function getMockOptionChain(underlyingPrice: number, direction: 'PUT' | 'CALL'): Strike[] {
  const strikes: Strike[] = [];
  const today = new Date();

  // Generate strikes around the underlying price
  // For PUTs: below current price, for CALLs: above current price
  const strikeIncrement = 1; // $1 increments for SPY
  const numStrikes = 20;

  for (let i = 0; i < numStrikes; i++) {
    let strikePrice: number;
    let delta: number;

    if (direction === 'PUT') {
      // Put strikes below current price
      strikePrice = Math.floor(underlyingPrice - (i * strikeIncrement));
      // Delta gets smaller (closer to 0) as we go further OTM
      // Rough approximation: -0.50 at ATM, approaching 0 as we go OTM
      const moneyness = (underlyingPrice - strikePrice) / underlyingPrice;
      delta = Math.max(0.05, 0.50 - (moneyness * 2.5)); // Simplified delta calc
    } else {
      // Call strikes above current price
      strikePrice = Math.ceil(underlyingPrice + (i * strikeIncrement));
      // Delta gets smaller as we go further OTM
      const moneyness = (strikePrice - underlyingPrice) / underlyingPrice;
      delta = Math.max(0.05, 0.50 - (moneyness * 2.5));
    }

    // Mock bid-ask spread (tighter for more liquid strikes)
    const spread = delta > 0.3 ? 0.02 : delta > 0.2 ? 0.03 : 0.05;
    const midPrice = delta * 2; // Rough approximation
    const bid = midPrice - spread / 2;
    const ask = midPrice + spread / 2;

    // Add strike to chain
    strikes.push({
      strike: strikePrice,
      expiration: new Date(today.getTime() + (1000 * 60 * 60 * 24)), // 1 day expiry
      delta: Number(delta.toFixed(3)),
      bid: Number(bid.toFixed(2)),
      ask: Number(ask.toFixed(2)),
      openInterest: Math.floor(Math.random() * 1000) + 100,
      impliedVolatility: 0.15 + (Math.random() * 0.10) // 15-25% IV
    });
  }

  return strikes;
}

/**
 * Find the best strike that matches our delta target
 * @param strikes - Available strikes
 * @param targetDelta - Target delta value
 * @returns Best matching strike
 */
function findBestStrike(strikes: Strike[], targetDelta: number = TARGET_DELTA_IDEAL): Strike | null {
  // Filter strikes within our delta range
  const validStrikes = strikes.filter(s =>
    s.delta >= TARGET_DELTA_MIN &&
    s.delta <= TARGET_DELTA_MAX
  );

  if (validStrikes.length === 0) {
    // If no strikes in range, find closest one
    const closest = strikes.reduce((prev, curr) => {
      const prevDiff = Math.abs(prev.delta - targetDelta);
      const currDiff = Math.abs(curr.delta - targetDelta);
      return currDiff < prevDiff ? curr : prev;
    });
    return closest;
  }

  // Find strike closest to ideal delta
  return validStrikes.reduce((prev, curr) => {
    const prevDiff = Math.abs(prev.delta - targetDelta);
    const currDiff = Math.abs(curr.delta - targetDelta);
    return currDiff < prevDiff ? curr : prev;
  });
}

/**
 * Calculate expected premium for selected strikes
 * @param putStrike - Selected put strike
 * @param callStrike - Selected call strike
 * @returns Total expected premium (using mid price)
 */
function calculateExpectedPremium(putStrike?: Strike, callStrike?: Strike): number {
  let premium = 0;

  if (putStrike) {
    const midPrice = (putStrike.bid + putStrike.ask) / 2;
    premium += midPrice * 100; // Convert to dollar amount per contract
  }

  if (callStrike) {
    const midPrice = (callStrike.bid + callStrike.ask) / 2;
    premium += midPrice * 100; // Convert to dollar amount per contract
  }

  return Number(premium.toFixed(2));
}

/**
 * Calculate margin requirement for selected strikes
 * For naked options: ~15-20% of notional
 * For strangles: ~12% due to offsetting
 * @param putStrike - Selected put strike
 * @param callStrike - Selected call strike
 * @returns Estimated margin requirement
 */
function calculateMarginRequirement(putStrike?: Strike, callStrike?: Strike): number {
  let margin = 0;
  const marginRate = putStrike && callStrike ? 0.12 : 0.18; // Lower for strangles

  if (putStrike) {
    margin += putStrike.strike * 100 * marginRate;
  }

  if (callStrike) {
    margin += callStrike.strike * 100 * marginRate;
  }

  return Number(margin.toFixed(2));
}

/**
 * Convert cached option chain to Strike format
 */
function convertCachedToStrikes(
  cached: CachedOptionChain,
  direction: 'PUT' | 'CALL'
): { strikes: Strike[]; underlyingPrice: number; vix?: number; expectedMove?: number } {
  const today = new Date();
  const expiration = new Date(today);
  expiration.setHours(16, 0, 0, 0); // 4 PM ET close

  const sourceStrikes = direction === 'PUT' ? cached.puts : cached.calls;

  const strikes: Strike[] = sourceStrikes.map(opt => ({
    strike: opt.strike,
    expiration,
    delta: Math.abs(opt.delta ?? 0), // Use absolute delta for comparison
    bid: opt.bid,
    ask: opt.ask,
    gamma: opt.gamma,
    theta: opt.theta,
    vega: opt.vega,
    openInterest: opt.openInterest ?? 0,
    impliedVolatility: opt.iv ?? 0.20,
  }));

  return {
    strikes,
    underlyingPrice: cached.underlyingPrice,
    vix: cached.vix,
    expectedMove: cached.expectedMove,
  };
}

// Cache for option chain data within a single selectStrikes call
interface FullOptionChainResult {
  putStrikes: Strike[];
  callStrikes: Strike[];
  underlyingPrice: number;
  vix?: number;
  expectedMove?: number;
  source: 'websocket' | 'http' | 'mock';
}

/**
 * Fetch full option chain from IBKR (both PUT and CALL) in a single call
 * Now includes real Greeks (delta, gamma, theta, vega), IV, and open interest from IBKR
 *
 * Data source priority:
 * 1. WebSocket cache (instant, real-time) - if streaming is active
 * 2. HTTP snapshot (200-500ms) - fallback when cache is stale or unavailable
 *
 * @param symbol - Underlying symbol (e.g., 'SPY')
 * @returns Full option chain with both PUT and CALL strikes
 */
async function fetchFullOptionChain(symbol: string): Promise<FullOptionChainResult | null> {
  const today = new Date();
  const expiration = new Date(today);
  expiration.setHours(16, 0, 0, 0); // 4 PM ET close

  try {
    // Priority 1: Try WebSocket cache first (instant, real-time)
    const streamer = getOptionChainStreamer();
    const cachedChain = streamer.getOptionChain(symbol);

    if (cachedChain && cachedChain.underlyingPrice > 0) {
      const putResult = convertCachedToStrikes(cachedChain, 'PUT');
      const callResult = convertCachedToStrikes(cachedChain, 'CALL');

      if (putResult.strikes.length > 0 || callResult.strikes.length > 0) {
        console.log(`[Step3] Using WebSocket cache: ${putResult.strikes.length} PUTs, ${callResult.strikes.length} CALLs, underlying: $${cachedChain.underlyingPrice}`);
        return {
          putStrikes: putResult.strikes,
          callStrikes: callResult.strikes,
          underlyingPrice: cachedChain.underlyingPrice,
          vix: cachedChain.vix,
          expectedMove: cachedChain.expectedMove,
          source: 'websocket'
        };
      }
    }

    // Priority 2: Fall back to HTTP snapshot
    console.log(`[Step3] WebSocket cache unavailable, fetching HTTP snapshot for ${symbol}...`);
    const chainData = await getOptionChainWithStrikes(symbol);

    if (!chainData || chainData.underlyingPrice === 0) {
      console.log('[Step3] No real option chain data available from IBKR');
      return null;
    }

    const putStrikes: Strike[] = chainData.puts.map(opt => ({
      strike: opt.strike,
      expiration,
      delta: Math.abs(opt.delta), // Use absolute delta for comparison
      bid: opt.bid,
      ask: opt.ask,
      gamma: opt.gamma,
      theta: opt.theta,
      vega: opt.vega,
      openInterest: opt.openInterest ?? 0,
      impliedVolatility: opt.iv ?? 0.20,
    }));

    const callStrikes: Strike[] = chainData.calls.map(opt => ({
      strike: opt.strike,
      expiration,
      delta: Math.abs(opt.delta),
      bid: opt.bid,
      ask: opt.ask,
      gamma: opt.gamma,
      theta: opt.theta,
      vega: opt.vega,
      openInterest: opt.openInterest ?? 0,
      impliedVolatility: opt.iv ?? 0.20,
    }));

    console.log(`[Step3] HTTP snapshot: ${putStrikes.length} PUTs, ${callStrikes.length} CALLs (VIX: ${chainData.vix}, expected move: $${chainData.expectedMove?.toFixed(2)}), underlying: $${chainData.underlyingPrice}`);
    return {
      putStrikes,
      callStrikes,
      underlyingPrice: chainData.underlyingPrice,
      vix: chainData.vix,
      expectedMove: chainData.expectedMove,
      source: 'http'
    };
  } catch (err) {
    console.error('[Step3] Error fetching real option chain:', err);
    return null;
  }
}

/**
 * Legacy function for backward compatibility
 */
async function fetchRealOptionChain(
  symbol: string,
  direction: 'PUT' | 'CALL'
): Promise<{ strikes: Strike[]; underlyingPrice: number; vix?: number; expectedMove?: number } | null> {
  const fullChain = await fetchFullOptionChain(symbol);
  if (!fullChain) return null;

  return {
    strikes: direction === 'PUT' ? fullChain.putStrikes : fullChain.callStrikes,
    underlyingPrice: fullChain.underlyingPrice,
    vix: fullChain.vix,
    expectedMove: fullChain.expectedMove
  };
}

/**
 * Main function: Select optimal strikes based on delta targeting
 * Uses real IBKR data when available, falls back to mock data
 *
 * IMPORTANT: Fetches option chain ONCE and reuses for both PUT and CALL
 * to ensure consistent data source across the entire trade.
 *
 * @param direction - Trade direction from Step 2
 * @param underlyingPrice - Current price of underlying (used as fallback)
 * @param symbol - Underlying symbol (default: 'SPY')
 * @returns Selected strikes with expected premium
 */
export async function selectStrikes(
  direction: TradeDirection,
  underlyingPrice: number = 450, // Default SPY price for testing
  symbol: string = 'SPY'
): Promise<StrikeSelection> {
  const selection: StrikeSelection = {
    expectedPremium: 0,
    marginRequired: 0,
    reasoning: ''
  };

  let actualUnderlyingPrice = underlyingPrice;
  let dataSource: 'websocket' | 'http' | 'mock' = 'mock';

  // CRITICAL: Fetch option chain ONCE and reuse for both PUT and CALL
  // This ensures consistent data source and avoids the bug where PUT uses IBKR but CALL uses mock
  const fullChain = await fetchFullOptionChain(symbol);

  if (fullChain && (fullChain.putStrikes.length > 0 || fullChain.callStrikes.length > 0)) {
    actualUnderlyingPrice = fullChain.underlyingPrice;
    dataSource = fullChain.source;

    // Select PUT strike from real data
    if (direction === 'PUT' || direction === 'STRANGLE') {
      if (fullChain.putStrikes.length > 0) {
        const putStrike = findBestStrike(fullChain.putStrikes);
        if (putStrike) {
          selection.putStrike = putStrike;
          selection.reasoning += `PUT (IBKR ${dataSource}): Strike $${putStrike.strike} with delta ${putStrike.delta.toFixed(3)}. `;
        }
      } else {
        throw new Error('[IBKR] No PUT strikes available - cannot proceed without real option data');
      }
    }

    // Select CALL strike from real data
    if (direction === 'CALL' || direction === 'STRANGLE') {
      if (fullChain.callStrikes.length > 0) {
        const callStrike = findBestStrike(fullChain.callStrikes);
        if (callStrike) {
          selection.callStrike = callStrike;
          selection.reasoning += `CALL (IBKR ${dataSource}): Strike $${callStrike.strike} with delta ${callStrike.delta.toFixed(3)}. `;
        }
      } else {
        throw new Error('[IBKR] No CALL strikes available - cannot proceed without real option data');
      }
    }

    // Collect nearby strikes for UI display from the same data source
    const nearbyStrikes: {
      puts: Array<{ strike: number; bid: number; ask: number; delta: number; oi?: number }>;
      calls: Array<{ strike: number; bid: number; ask: number; delta: number; oi?: number }>;
    } = { puts: [], calls: [] };

    if (direction === 'PUT' || direction === 'STRANGLE') {
      const selectedStrike = selection.putStrike?.strike;
      const sortedPuts = [...fullChain.putStrikes].sort((a, b) => {
        if (selectedStrike) {
          return Math.abs(a.strike - selectedStrike) - Math.abs(b.strike - selectedStrike);
        }
        return Math.abs(a.strike - actualUnderlyingPrice) - Math.abs(b.strike - actualUnderlyingPrice);
      });
      nearbyStrikes.puts = sortedPuts.slice(0, 7).map(s => ({
        strike: s.strike,
        bid: s.bid,
        ask: s.ask,
        delta: s.delta,
        oi: s.openInterest
      })).sort((a, b) => a.strike - b.strike);
    }

    if (direction === 'CALL' || direction === 'STRANGLE') {
      const selectedStrike = selection.callStrike?.strike;
      const sortedCalls = [...fullChain.callStrikes].sort((a, b) => {
        if (selectedStrike) {
          return Math.abs(a.strike - selectedStrike) - Math.abs(b.strike - selectedStrike);
        }
        return Math.abs(a.strike - actualUnderlyingPrice) - Math.abs(b.strike - actualUnderlyingPrice);
      });
      nearbyStrikes.calls = sortedCalls.slice(0, 7).map(s => ({
        strike: s.strike,
        bid: s.bid,
        ask: s.ask,
        delta: s.delta,
        oi: s.openInterest
      })).sort((a, b) => a.strike - b.strike);
    }

    if (nearbyStrikes.puts.length > 0 || nearbyStrikes.calls.length > 0) {
      selection.nearbyStrikes = nearbyStrikes;
    }

  } else {
    // IBKR completely unavailable - throw error, no mock fallback
    throw new Error('[IBKR] Option chain unavailable - cannot proceed without real IBKR data');
  }

  // Calculate totals
  selection.expectedPremium = calculateExpectedPremium(selection.putStrike, selection.callStrike);
  selection.marginRequired = calculateMarginRequirement(selection.putStrike, selection.callStrike);

  // Add summary to reasoning
  const sourceLabel = dataSource === 'mock' ? 'MOCK estimates' : `IBKR ${dataSource}`;
  selection.reasoning += `Data source: ${sourceLabel}. Underlying: $${actualUnderlyingPrice.toFixed(2)}. `;
  selection.reasoning += `Expected premium: $${selection.expectedPremium}, Margin required: $${selection.marginRequired}`;

  return selection;
}

