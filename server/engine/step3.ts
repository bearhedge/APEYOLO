/**
 * Step 3: Strike Selection
 * Selects optimal strike prices based on delta targeting (0.15-0.20)
 *
 * Uses real IBKR option chain data when available, falls back to mock data
 */

import { TradeDirection } from './step2';
import { getOptionChainWithStrikes } from '../broker/ibkr';
import { getOptionChainStreamer, CachedOptionChain } from '../broker/optionChainStreamer';
import type { StepReasoning, StepMetric, NearbyStrike } from '../../shared/types/engineLog';

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
  // Enhanced logging for UI
  stepReasoning?: StepReasoning[];
  stepMetrics?: StepMetric[];
  enhancedNearbyStrikes?: NearbyStrike[];  // Flat array for UI table display
}

/**
 * Target delta ranges for option selection
 * For selling premium, we want strikes that are OTM but not too far
 *
 * PUTs have NEGATIVE delta (e.g., -0.30)
 * CALLs have POSITIVE delta (e.g., +0.30)
 *
 * Target ~0.30 delta = ~70% probability of expiring worthless
 * This gives decent premium while maintaining safety margin
 */
const PUT_DELTA_TARGET = { min: -0.35, max: -0.25, ideal: -0.30 };
const CALL_DELTA_TARGET = { min: 0.25, max: 0.35, ideal: 0.30 };

// Legacy constants for backward compatibility (absolute values)
const TARGET_DELTA_MIN = 0.25;
const TARGET_DELTA_MAX = 0.35;
const TARGET_DELTA_IDEAL = 0.30;

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
 * IMPORTANT: Uses SIGNED deltas - PUTs have negative delta, CALLs have positive
 *
 * @param strikes - Available strikes with signed deltas
 * @param direction - 'PUT' or 'CALL' to select appropriate delta range
 * @returns Best matching strike
 */
function findBestStrike(strikes: Strike[], direction: 'PUT' | 'CALL'): Strike | null {
  // Get the appropriate delta range based on direction
  const deltaTarget = direction === 'PUT' ? PUT_DELTA_TARGET : CALL_DELTA_TARGET;

  // For PUTs: delta should be negative (e.g., -0.35 to -0.25)
  // For CALLs: delta should be positive (e.g., 0.25 to 0.35)
  const validStrikes = strikes.filter(s => {
    if (direction === 'PUT') {
      // PUT deltas are negative, filter by range (min is more negative, max is less negative)
      return s.delta >= deltaTarget.min && s.delta <= deltaTarget.max;
    } else {
      // CALL deltas are positive
      return s.delta >= deltaTarget.min && s.delta <= deltaTarget.max;
    }
  });

  console.log(`[Step3] findBestStrike(${direction}): ${strikes.length} total strikes, ${validStrikes.length} in target range [${deltaTarget.min}, ${deltaTarget.max}]`);

  if (validStrikes.length === 0) {
    // If no strikes in range, find closest one to ideal
    console.log(`[Step3] No strikes in target range, finding closest to ideal ${deltaTarget.ideal}`);
    if (strikes.length === 0) return null;

    const closest = strikes.reduce((prev, curr) => {
      const prevDiff = Math.abs(prev.delta - deltaTarget.ideal);
      const currDiff = Math.abs(curr.delta - deltaTarget.ideal);
      return currDiff < prevDiff ? curr : prev;
    });
    console.log(`[Step3] Closest strike: $${closest.strike} with delta ${closest.delta}`);
    return closest;
  }

  // Find strike closest to ideal delta
  const best = validStrikes.reduce((prev, curr) => {
    const prevDiff = Math.abs(prev.delta - deltaTarget.ideal);
    const currDiff = Math.abs(curr.delta - deltaTarget.ideal);
    return currDiff < prevDiff ? curr : prev;
  });
  console.log(`[Step3] Best strike in range: $${best.strike} with delta ${best.delta}`);
  return best;
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
    delta: opt.delta ?? 0, // KEEP original signed delta from IBKR (negative for PUT, positive for CALL)
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
  diagnostics?: {
    conid: number | null;
    symbol: string;
    monthInput: string;
    monthFormatted: string;
    strikesUrl: string;
    strikesStatus: number;
    strikesRaw: string;
    snapshotRaw: string;
    putCount: number;
    callCount: number;
    underlyingPrice: number;
    vix: number;
    timestamp: string;
    error?: string;
  };
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

    // Always capture diagnostics for debugging
    const diagnostics = chainData?.diagnostics;

    if (!chainData || (chainData.underlyingPrice === 0 && chainData.puts.length === 0 && chainData.calls.length === 0)) {
      console.log('[Step3] No real option chain data available from IBKR');
      console.log('[Step3] Diagnostics:', JSON.stringify(diagnostics, null, 2));
      // Return result with diagnostics even when empty for debugging
      return {
        putStrikes: [],
        callStrikes: [],
        underlyingPrice: chainData?.underlyingPrice || 0,
        vix: chainData?.vix,
        expectedMove: chainData?.expectedMove,
        source: 'http',
        diagnostics,
      };
    }

    const putStrikes: Strike[] = chainData.puts.map(opt => ({
      strike: opt.strike,
      expiration,
      delta: opt.delta, // KEEP original signed delta (negative for PUTs)
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
      delta: opt.delta, // KEEP original signed delta (positive for CALLs)
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
      source: 'http',
      diagnostics,
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
  console.log(`[Step3] Strike Selection START`);
  console.log(`[Step3] Direction: ${direction}, Underlying fallback price: $${underlyingPrice.toFixed(2)}, Symbol: ${symbol}`);

  const selection: StrikeSelection = {
    expectedPremium: 0,
    marginRequired: 0,
    reasoning: ''
  };

  let actualUnderlyingPrice = underlyingPrice;
  let dataSource: 'websocket' | 'http' | 'mock' = 'mock';

  // CRITICAL: Fetch option chain ONCE and reuse for both PUT and CALL
  // This ensures consistent data source and avoids the bug where PUT uses IBKR but CALL uses mock
  console.log(`[Step3] Fetching option chain for ${symbol}...`);
  const chainStart = Date.now();
  const fullChain = await fetchFullOptionChain(symbol);
  console.log(`[Step3] Option chain fetch took ${Date.now() - chainStart}ms`);

  if (fullChain && (fullChain.putStrikes.length > 0 || fullChain.callStrikes.length > 0)) {
    actualUnderlyingPrice = fullChain.underlyingPrice;
    dataSource = fullChain.source;
    console.log(`[Step3] Data source: ${dataSource}`);
    console.log(`[Step3] Underlying price: $${actualUnderlyingPrice.toFixed(2)}`);
    console.log(`[Step3] PUT strikes available: ${fullChain.putStrikes.length}`);
    console.log(`[Step3] CALL strikes available: ${fullChain.callStrikes.length}`);
    if (fullChain.vix) console.log(`[Step3] VIX from chain: ${fullChain.vix}`);
    if (fullChain.expectedMove) console.log(`[Step3] Expected move: $${fullChain.expectedMove.toFixed(2)}`);

    // Select PUT strike from real data (PUTs have NEGATIVE delta)
    if (direction === 'PUT' || direction === 'STRANGLE') {
      if (fullChain.putStrikes.length > 0) {
        const putStrike = findBestStrike(fullChain.putStrikes, 'PUT');
        if (putStrike) {
          selection.putStrike = putStrike;
          console.log(`[Step3] Selected PUT: $${putStrike.strike} (delta: ${putStrike.delta.toFixed(3)}, bid: $${putStrike.bid.toFixed(2)}, ask: $${putStrike.ask.toFixed(2)})`);
          selection.reasoning += `PUT (IBKR ${dataSource}): Strike $${putStrike.strike} with delta ${putStrike.delta.toFixed(3)}. `;
        } else {
          console.error(`[Step3] Failed to find PUT strike matching delta target ${PUT_DELTA_TARGET.ideal}`);
        }
      } else {
        console.error(`[Step3] No PUT strikes in option chain`);
        throw new Error('[IBKR] No PUT strikes available - cannot proceed without real option data');
      }
    }

    // Select CALL strike from real data (CALLs have POSITIVE delta)
    if (direction === 'CALL' || direction === 'STRANGLE') {
      if (fullChain.callStrikes.length > 0) {
        const callStrike = findBestStrike(fullChain.callStrikes, 'CALL');
        if (callStrike) {
          selection.callStrike = callStrike;
          console.log(`[Step3] Selected CALL: $${callStrike.strike} (delta: ${callStrike.delta.toFixed(3)}, bid: $${callStrike.bid.toFixed(2)}, ask: $${callStrike.ask.toFixed(2)})`);
          selection.reasoning += `CALL (IBKR ${dataSource}): Strike $${callStrike.strike} with delta ${callStrike.delta.toFixed(3)}. `;
        } else {
          console.error(`[Step3] Failed to find CALL strike matching delta target ${CALL_DELTA_TARGET.ideal}`);
        }
      } else {
        console.error(`[Step3] No CALL strikes in option chain`);
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
    // IBKR completely unavailable - throw error with diagnostics for debugging
    console.error(`[Step3] Option chain returned NULL or EMPTY from fetchFullOptionChain`);
    console.error(`[Step3] fullChain: ${JSON.stringify(fullChain)}`);

    // Create a detailed error with diagnostics attached
    const diagnostics = fullChain?.diagnostics;
    const errorMessage = diagnostics
      ? `[IBKR] Option chain unavailable. Diagnostics: conid=${diagnostics.conid}, month=${diagnostics.monthFormatted}, puts=${diagnostics.putCount}, calls=${diagnostics.callCount}, price=$${diagnostics.underlyingPrice}, snapshot=${diagnostics.snapshotRaw?.slice(0, 100)}, strikes=${diagnostics.strikesRaw?.slice(0, 100)}`
      : '[IBKR] Option chain unavailable - cannot proceed without real IBKR data';

    const error = new Error(errorMessage) as Error & {
      diagnostics?: typeof diagnostics;
      isOptionChainError?: boolean;
    };
    error.diagnostics = diagnostics;
    error.isOptionChainError = true;
    throw error;
  }

  // Calculate totals
  selection.expectedPremium = calculateExpectedPremium(selection.putStrike, selection.callStrike);
  selection.marginRequired = calculateMarginRequirement(selection.putStrike, selection.callStrike);

  // CRITICAL: Validate premium - if $0, warn that bid/ask data is unavailable (market likely closed)
  if (selection.expectedPremium <= 0) {
    console.warn(`[Step3] WARNING: Expected premium is $0 - bid/ask data unavailable (market may be closed)`);
    console.warn(`[Step3] PUT bid/ask: ${selection.putStrike?.bid ?? 'N/A'}/${selection.putStrike?.ask ?? 'N/A'}`);
    console.warn(`[Step3] CALL bid/ask: ${selection.callStrike?.bid ?? 'N/A'}/${selection.callStrike?.ask ?? 'N/A'}`);
    selection.reasoning += `⚠️ WARNING: Premium is $0 - market may be closed, bid/ask unavailable. `;
  }

  // Add summary to reasoning
  const sourceLabel = dataSource === 'mock' ? 'MOCK estimates' : `IBKR ${dataSource}`;
  selection.reasoning += `Data source: ${sourceLabel}. Underlying: $${actualUnderlyingPrice.toFixed(2)}. `;
  selection.reasoning += `Expected premium: $${selection.expectedPremium}, Margin required: $${selection.marginRequired}`;

  // Build enhanced reasoning Q&A
  const selectedStrike = selection.putStrike || selection.callStrike;
  const selectedType = selection.putStrike ? 'PUT' : 'CALL';
  const targetDelta = selectedType === 'PUT' ? PUT_DELTA_TARGET : CALL_DELTA_TARGET;

  selection.stepReasoning = [
    {
      question: 'What delta are we targeting?',
      answer: `~${Math.abs(targetDelta.ideal).toFixed(2)} (${Math.abs(targetDelta.min).toFixed(2)}-${Math.abs(targetDelta.max).toFixed(2)} range)`
    },
    {
      question: 'Why this delta?',
      answer: '~70% probability OTM - good premium with safety margin'
    },
    {
      question: 'Which strike selected?',
      answer: selectedStrike
        ? `$${selectedStrike.strike} ${selectedType} (delta: ${selectedStrike.delta.toFixed(3)})`
        : 'None selected'
    },
    {
      question: 'Data source?',
      answer: dataSource === 'websocket'
        ? 'IBKR WebSocket (real-time)'
        : dataSource === 'http'
          ? 'IBKR HTTP (snapshot)'
          : 'Mock data (testing)'
    },
    {
      question: 'Premium acceptable?',
      answer: selection.expectedPremium > 0
        ? `YES ($${selection.expectedPremium.toFixed(2)} per contract)`
        : 'NO ($0 - market may be closed)'
    }
  ];

  // Build enhanced metrics
  selection.stepMetrics = [
    {
      label: 'Selected Strike',
      value: selectedStrike ? `$${selectedStrike.strike}` : 'N/A',
      status: selectedStrike ? 'normal' : 'critical'
    },
    {
      label: 'Delta',
      value: selectedStrike ? selectedStrike.delta.toFixed(3) : 'N/A',
      status: selectedStrike
        ? (Math.abs(selectedStrike.delta) >= Math.abs(targetDelta.min) &&
           Math.abs(selectedStrike.delta) <= Math.abs(targetDelta.max)
            ? 'normal'
            : 'warning')
        : 'critical'
    },
    {
      label: 'Bid/Ask',
      value: selectedStrike
        ? `$${selectedStrike.bid.toFixed(2)}/$${selectedStrike.ask.toFixed(2)}`
        : 'N/A',
      status: selectedStrike && selectedStrike.bid > 0 ? 'normal' : 'warning'
    },
    {
      label: 'Spread',
      value: selectedStrike
        ? `$${(selectedStrike.ask - selectedStrike.bid).toFixed(2)}`
        : 'N/A',
      status: selectedStrike && (selectedStrike.ask - selectedStrike.bid) <= 0.05 ? 'normal' : 'warning'
    },
    {
      label: 'Premium',
      value: `$${selection.expectedPremium.toFixed(2)}`,
      status: selection.expectedPremium > 0 ? 'normal' : 'critical'
    },
    {
      label: 'Margin Req',
      value: `$${selection.marginRequired.toFixed(0)}`,
      status: 'normal'
    }
  ];

  // Build enhanced nearby strikes table for UI
  // Combine puts and calls into a flat array, marking the selected one
  const enhancedNearbyStrikes: NearbyStrike[] = [];

  if (selection.nearbyStrikes?.puts) {
    for (const s of selection.nearbyStrikes.puts) {
      enhancedNearbyStrikes.push({
        strike: s.strike,
        optionType: 'PUT',
        delta: s.delta,
        bid: s.bid,
        ask: s.ask,
        spread: Number((s.ask - s.bid).toFixed(2)),
        selected: selection.putStrike?.strike === s.strike
      });
    }
  }

  if (selection.nearbyStrikes?.calls) {
    for (const s of selection.nearbyStrikes.calls) {
      enhancedNearbyStrikes.push({
        strike: s.strike,
        optionType: 'CALL',
        delta: s.delta,
        bid: s.bid,
        ask: s.ask,
        spread: Number((s.ask - s.bid).toFixed(2)),
        selected: selection.callStrike?.strike === s.strike
      });
    }
  }

  if (enhancedNearbyStrikes.length > 0) {
    selection.enhancedNearbyStrikes = enhancedNearbyStrikes;
  }

  console.log(`[Step3] Strike Selection COMPLETE`);
  console.log(`[Step3] Expected premium: $${selection.expectedPremium}, Margin: $${selection.marginRequired}`);

  return selection;
}

