/**
 * Step 3: Strike Selection
 * Selects optimal strike prices based on delta targeting
 *
 * Enhanced implementation with:
 * - Real IBKR option chain data integration
 * - Dynamic delta targeting from Step 2 (0.15-0.20 normal, 0.10-0.15 neutral/strangle)
 * - Transparent reasoning chain
 * - Liquidity and spread analysis
 *
 * Rules:
 * - For directional trades: Target delta 0.15-0.20
 * - For neutral/strangle: Target delta 0.10-0.15 (further OTM for safety)
 * - Prioritize liquid strikes with tight spreads
 * - Use IBKR real-time data when available
 */

import { TradeDirection, DirectionDecision } from './step2';
import { getOptionChainWithStrikes } from '../broker/ibkr';
import {
  createReasoning,
  StepReasoning,
  formatNumber,
  formatCurrency,
  formatPercent,
} from './reasoningLogger';

export interface Strike {
  strike: number;
  expiration: Date;
  delta: number;
  bid: number;
  ask: number;
  openInterest?: number;
  impliedVolatility?: number;
}

export interface StrikeSelection {
  putStrike?: Strike;
  callStrike?: Strike;
  expectedPremium: number;
  marginRequired: number;
  reason: string;  // Short reason for display
  nearbyStrikes?: {
    puts: Array<{ strike: number; bid: number; ask: number; delta: number; oi?: number }>;
    calls: Array<{ strike: number; bid: number; ask: number; delta: number; oi?: number }>;
  };
  // NEW: Transparent reasoning chain
  reasoning?: StepReasoning;
}

/**
 * Default delta range for option selection
 * 0.15-0.20 provides ~80-85% probability of expiring worthless
 * For neutral/strangle trades: use 0.10-0.15 (further OTM)
 */
const DEFAULT_DELTA_MIN = 0.15;
const DEFAULT_DELTA_MAX = 0.20;
const DEFAULT_DELTA_IDEAL = 0.18;

// Neutral/Strangle delta range (further OTM for safety)
const NEUTRAL_DELTA_MIN = 0.10;
const NEUTRAL_DELTA_MAX = 0.15;
const NEUTRAL_DELTA_IDEAL = 0.12;

// Spread quality thresholds
const MAX_ACCEPTABLE_SPREAD_PERCENT = 0.15; // 15% max bid-ask spread
const IDEAL_SPREAD_PERCENT = 0.05; // 5% ideal spread

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
 * Delta target configuration from Step 2
 */
interface DeltaTarget {
  min: number;
  max: number;
  ideal: number;
}

/**
 * Get delta target configuration based on direction
 */
function getDeltaTarget(direction: TradeDirection): DeltaTarget {
  if (direction === 'STRANGLE') {
    // Neutral/Strangle: use further OTM for safety
    return {
      min: NEUTRAL_DELTA_MIN,
      max: NEUTRAL_DELTA_MAX,
      ideal: NEUTRAL_DELTA_IDEAL,
    };
  }
  // Directional trades: normal delta range
  return {
    min: DEFAULT_DELTA_MIN,
    max: DEFAULT_DELTA_MAX,
    ideal: DEFAULT_DELTA_IDEAL,
  };
}

/**
 * Calculate spread quality score (0-1, higher is better)
 */
function calculateSpreadScore(strike: Strike): number {
  if (strike.bid <= 0) return 0;
  const spreadPercent = (strike.ask - strike.bid) / strike.bid;
  if (spreadPercent >= MAX_ACCEPTABLE_SPREAD_PERCENT) return 0;
  if (spreadPercent <= IDEAL_SPREAD_PERCENT) return 1;
  // Linear interpolation between ideal and max
  return 1 - ((spreadPercent - IDEAL_SPREAD_PERCENT) / (MAX_ACCEPTABLE_SPREAD_PERCENT - IDEAL_SPREAD_PERCENT));
}

/**
 * Find the best strike that matches our delta target
 * @param strikes - Available strikes
 * @param deltaTarget - Target delta configuration
 * @returns Best matching strike with selection info
 */
function findBestStrike(
  strikes: Strike[],
  deltaTarget: DeltaTarget
): { strike: Strike | null; inRange: boolean; alternatives: Strike[] } {
  if (strikes.length === 0) {
    return { strike: null, inRange: false, alternatives: [] };
  }

  // Filter strikes within our delta range
  const validStrikes = strikes.filter(s =>
    s.delta >= deltaTarget.min &&
    s.delta <= deltaTarget.max
  );

  // Score strikes based on delta proximity and spread quality
  const scoreStrike = (s: Strike): number => {
    const deltaDiff = Math.abs(s.delta - deltaTarget.ideal);
    const deltaScore = 1 - (deltaDiff / 0.10); // 0.10 is max expected diff
    const spreadScore = calculateSpreadScore(s);
    return (deltaScore * 0.7) + (spreadScore * 0.3); // Weight: 70% delta, 30% spread
  };

  if (validStrikes.length === 0) {
    // If no strikes in range, find closest one
    const sorted = [...strikes].sort((a, b) => scoreStrike(b) - scoreStrike(a));
    return {
      strike: sorted[0],
      inRange: false,
      alternatives: sorted.slice(1, 4),
    };
  }

  // Find best strike by combined score
  const sorted = validStrikes.sort((a, b) => scoreStrike(b) - scoreStrike(a));
  return {
    strike: sorted[0],
    inRange: true,
    alternatives: sorted.slice(1, 4),
  };
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
 * Fetch real option chain from IBKR and convert to Strike format
 * @param symbol - Underlying symbol (e.g., 'SPY')
 * @param direction - PUT, CALL, or STRANGLE
 * @returns Array of strikes from real IBKR data
 */
async function fetchRealOptionChain(
  symbol: string,
  direction: 'PUT' | 'CALL'
): Promise<{ strikes: Strike[]; underlyingPrice: number } | null> {
  try {
    const chainData = await getOptionChainWithStrikes(symbol);

    if (!chainData || chainData.underlyingPrice === 0) {
      console.log('[Step3] No real option chain data available from IBKR');
      return null;
    }

    const today = new Date();
    const expiration = new Date(today);
    expiration.setHours(16, 0, 0, 0); // 4 PM ET close

    const sourceStrikes = direction === 'PUT' ? chainData.puts : chainData.calls;

    const strikes: Strike[] = sourceStrikes.map(opt => ({
      strike: opt.strike,
      expiration,
      delta: Math.abs(opt.delta), // Use absolute delta for comparison
      bid: opt.bid,
      ask: opt.ask,
      openInterest: 0,
      impliedVolatility: 0.20, // Default IV estimate
    }));

    console.log(`[Step3] Fetched ${strikes.length} ${direction} strikes from IBKR, underlying price: $${chainData.underlyingPrice}`);
    return { strikes, underlyingPrice: chainData.underlyingPrice };
  } catch (err) {
    console.error('[Step3] Error fetching real option chain:', err);
    return null;
  }
}

/**
 * Main function: Select optimal strikes based on delta targeting
 * Uses real IBKR data when available, falls back to mock data
 *
 * This function builds a transparent reasoning chain showing:
 * 1. Delta target selection based on direction
 * 2. Option chain fetch (IBKR or mock)
 * 3. Strike selection with delta matching
 * 4. Spread quality analysis
 * 5. Premium and margin calculation
 *
 * @param directionDecision - Full direction decision from Step 2 (includes targetDelta)
 * @param underlyingPrice - Current price of underlying (used as fallback)
 * @param symbol - Underlying symbol (default: 'SPY')
 * @returns Selected strikes with expected premium and reasoning chain
 */
export async function selectStrikes(
  directionDecision: DirectionDecision,
  underlyingPrice: number = 450, // Default SPY price for testing
  symbol: string = 'SPY'
): Promise<StrikeSelection> {
  // Initialize reasoning builder
  const reasoning = createReasoning(3, 'Strike Selection');

  const direction = directionDecision.direction;

  const selection: StrikeSelection = {
    expectedPremium: 0,
    marginRequired: 0,
    reason: ''
  };

  let usingRealData = false;
  let actualUnderlyingPrice = underlyingPrice;

  // Step 3.1: Determine delta target based on direction
  const deltaTarget = getDeltaTarget(direction);
  const customDelta = directionDecision.targetDelta;

  // If Step 2 provided a custom delta target, use it
  if (customDelta) {
    deltaTarget.min = customDelta.min;
    deltaTarget.max = customDelta.max;
    deltaTarget.ideal = (customDelta.min + customDelta.max) / 2;
  }

  reasoning.addInput('direction', direction);
  reasoning.addInput('symbol', symbol);
  reasoning.addInput('fallbackUnderlyingPrice', underlyingPrice);
  reasoning.addInput('deltaTargetMin', deltaTarget.min);
  reasoning.addInput('deltaTargetMax', deltaTarget.max);
  reasoning.addInput('deltaTargetIdeal', deltaTarget.ideal);

  reasoning.addLogicStep(
    `Determining delta target for ${direction} trade`,
    direction === 'STRANGLE'
      ? `Neutral/Strangle: Using further OTM delta ${formatNumber(deltaTarget.min, 2)}-${formatNumber(deltaTarget.max, 2)} for safety`
      : `Directional: Using normal delta ${formatNumber(deltaTarget.min, 2)}-${formatNumber(deltaTarget.max, 2)}`
  );

  reasoning.addComputation(
    'Delta Target Selection',
    direction === 'STRANGLE' ? 'NEUTRAL → Further OTM' : 'DIRECTIONAL → Normal OTM',
    {
      direction,
      isStrangle: direction === 'STRANGLE',
      deltaMin: deltaTarget.min,
      deltaMax: deltaTarget.max,
      probability: direction === 'STRANGLE' ? '~90%' : '~80-85%',
    },
    `${deltaTarget.min}-${deltaTarget.max}`,
    `Target strikes with delta ${formatNumber(deltaTarget.min, 2)}-${formatNumber(deltaTarget.max, 2)} (${formatPercent(1 - deltaTarget.max)} prob OTM)`
  );

  // Step 3.2: Fetch and analyze PUT strikes
  if (direction === 'PUT' || direction === 'STRANGLE') {
    reasoning.addLogicStep('Fetching PUT option chain');

    const realData = await fetchRealOptionChain(symbol, 'PUT');

    if (realData && realData.strikes.length > 0) {
      usingRealData = true;
      actualUnderlyingPrice = realData.underlyingPrice;

      reasoning.addLogicStep(
        `Received ${realData.strikes.length} PUT strikes from IBKR`,
        `Underlying price: ${formatCurrency(actualUnderlyingPrice)}`
      );

      const putResult = findBestStrike(realData.strikes, deltaTarget);

      if (putResult.strike) {
        selection.putStrike = putResult.strike;
        const spreadScore = calculateSpreadScore(putResult.strike);

        reasoning.addComputation(
          'PUT Strike Selection',
          'findBestStrike(strikes, deltaTarget)',
          {
            availableStrikes: realData.strikes.length,
            selectedStrike: putResult.strike.strike,
            selectedDelta: putResult.strike.delta,
            inTargetRange: putResult.inRange,
            bid: putResult.strike.bid,
            ask: putResult.strike.ask,
            spreadScore: formatPercent(spreadScore),
          },
          putResult.strike.strike,
          putResult.inRange
            ? `Selected $${putResult.strike.strike} PUT with delta ${formatNumber(putResult.strike.delta, 3)} (in range)`
            : `Selected $${putResult.strike.strike} PUT with delta ${formatNumber(putResult.strike.delta, 3)} (closest available)`
        );
      }
    } else {
      // Fall back to mock data
      reasoning.addLogicStepWithWarning(
        'IBKR PUT chain unavailable, using mock data',
        'Mock data used for estimation only'
      );

      const putChain = getMockOptionChain(underlyingPrice, 'PUT');
      const putResult = findBestStrike(putChain, deltaTarget);

      if (putResult.strike) {
        selection.putStrike = putResult.strike;
        reasoning.addComputation(
          'PUT Strike Selection (Mock)',
          'findBestStrike(mockChain, deltaTarget)',
          {
            selectedStrike: putResult.strike.strike,
            selectedDelta: putResult.strike.delta,
            inTargetRange: putResult.inRange,
          },
          putResult.strike.strike,
          `Mock: $${putResult.strike.strike} PUT with delta ${formatNumber(putResult.strike.delta, 3)}`
        );
      }
    }
  }

  // Step 3.3: Fetch and analyze CALL strikes
  if (direction === 'CALL' || direction === 'STRANGLE') {
    reasoning.addLogicStep('Fetching CALL option chain');

    const realData = await fetchRealOptionChain(symbol, 'CALL');

    if (realData && realData.strikes.length > 0) {
      usingRealData = true;
      actualUnderlyingPrice = realData.underlyingPrice;

      reasoning.addLogicStep(
        `Received ${realData.strikes.length} CALL strikes from IBKR`,
        `Underlying price: ${formatCurrency(actualUnderlyingPrice)}`
      );

      const callResult = findBestStrike(realData.strikes, deltaTarget);

      if (callResult.strike) {
        selection.callStrike = callResult.strike;
        const spreadScore = calculateSpreadScore(callResult.strike);

        reasoning.addComputation(
          'CALL Strike Selection',
          'findBestStrike(strikes, deltaTarget)',
          {
            availableStrikes: realData.strikes.length,
            selectedStrike: callResult.strike.strike,
            selectedDelta: callResult.strike.delta,
            inTargetRange: callResult.inRange,
            bid: callResult.strike.bid,
            ask: callResult.strike.ask,
            spreadScore: formatPercent(spreadScore),
          },
          callResult.strike.strike,
          callResult.inRange
            ? `Selected $${callResult.strike.strike} CALL with delta ${formatNumber(callResult.strike.delta, 3)} (in range)`
            : `Selected $${callResult.strike.strike} CALL with delta ${formatNumber(callResult.strike.delta, 3)} (closest available)`
        );
      }
    } else {
      // Fall back to mock data
      reasoning.addLogicStepWithWarning(
        'IBKR CALL chain unavailable, using mock data',
        'Mock data used for estimation only'
      );

      const callChain = getMockOptionChain(underlyingPrice, 'CALL');
      const callResult = findBestStrike(callChain, deltaTarget);

      if (callResult.strike) {
        selection.callStrike = callResult.strike;
        reasoning.addComputation(
          'CALL Strike Selection (Mock)',
          'findBestStrike(mockChain, deltaTarget)',
          {
            selectedStrike: callResult.strike.strike,
            selectedDelta: callResult.strike.delta,
            inTargetRange: callResult.inRange,
          },
          callResult.strike.strike,
          `Mock: $${callResult.strike.strike} CALL with delta ${formatNumber(callResult.strike.delta, 3)}`
        );
      }
    }
  }

  // Step 3.4: Calculate totals
  selection.expectedPremium = calculateExpectedPremium(selection.putStrike, selection.callStrike);
  selection.marginRequired = calculateMarginRequirement(selection.putStrike, selection.callStrike);

  reasoning.addLogicStep(
    'Calculating expected premium and margin requirement'
  );

  reasoning.addComputation(
    'Premium Calculation',
    'sum(midPrice * 100) for each selected strike',
    {
      putPremium: selection.putStrike
        ? formatCurrency(((selection.putStrike.bid + selection.putStrike.ask) / 2) * 100)
        : 'N/A',
      callPremium: selection.callStrike
        ? formatCurrency(((selection.callStrike.bid + selection.callStrike.ask) / 2) * 100)
        : 'N/A',
    },
    selection.expectedPremium,
    `Total expected premium: ${formatCurrency(selection.expectedPremium)}`
  );

  const marginRate = selection.putStrike && selection.callStrike ? 0.12 : 0.18;
  reasoning.addComputation(
    'Margin Calculation',
    direction === 'STRANGLE'
      ? 'strikeValue * 100 * 0.12 (strangle offset)'
      : 'strikeValue * 100 * 0.18 (naked)',
    {
      marginRate: formatPercent(marginRate),
      isStrangle: direction === 'STRANGLE',
    },
    selection.marginRequired,
    `Estimated margin: ${formatCurrency(selection.marginRequired)}`
  );

  // Collect nearby strikes for UI display
  const nearbyStrikes: {
    puts: Array<{ strike: number; bid: number; ask: number; delta: number; oi?: number }>;
    calls: Array<{ strike: number; bid: number; ask: number; delta: number; oi?: number }>;
  } = { puts: [], calls: [] };

  // Try to get nearby put strikes
  if (direction === 'PUT' || direction === 'STRANGLE') {
    const putData = await fetchRealOptionChain(symbol, 'PUT');
    if (putData && putData.strikes.length > 0) {
      const selectedStrike = selection.putStrike?.strike;
      const sortedPuts = [...putData.strikes].sort((a, b) => {
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
    } else {
      // Use mock data for nearby put strikes when IBKR unavailable
      const mockPutChain = getMockOptionChain(actualUnderlyingPrice, 'PUT');
      const selectedStrike = selection.putStrike?.strike;
      const sortedMockPuts = [...mockPutChain].sort((a, b) => {
        if (selectedStrike) {
          return Math.abs(a.strike - selectedStrike) - Math.abs(b.strike - selectedStrike);
        }
        return Math.abs(a.strike - actualUnderlyingPrice) - Math.abs(b.strike - actualUnderlyingPrice);
      });
      nearbyStrikes.puts = sortedMockPuts.slice(0, 7).map(s => ({
        strike: s.strike,
        bid: s.bid,
        ask: s.ask,
        delta: s.delta,
        oi: s.openInterest
      })).sort((a, b) => a.strike - b.strike);
    }
  }

  // Try to get nearby call strikes
  if (direction === 'CALL' || direction === 'STRANGLE') {
    const callData = await fetchRealOptionChain(symbol, 'CALL');
    if (callData && callData.strikes.length > 0) {
      const selectedStrike = selection.callStrike?.strike;
      const sortedCalls = [...callData.strikes].sort((a, b) => {
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
    } else {
      // Use mock data for nearby call strikes when IBKR unavailable
      const mockCallChain = getMockOptionChain(actualUnderlyingPrice, 'CALL');
      const selectedStrike = selection.callStrike?.strike;
      const sortedMockCalls = [...mockCallChain].sort((a, b) => {
        if (selectedStrike) {
          return Math.abs(a.strike - selectedStrike) - Math.abs(b.strike - selectedStrike);
        }
        return Math.abs(a.strike - actualUnderlyingPrice) - Math.abs(b.strike - actualUnderlyingPrice);
      });
      nearbyStrikes.calls = sortedMockCalls.slice(0, 7).map(s => ({
        strike: s.strike,
        bid: s.bid,
        ask: s.ask,
        delta: s.delta,
        oi: s.openInterest
      })).sort((a, b) => a.strike - b.strike);
    }
  }

  // Add nearby strikes to selection
  if (nearbyStrikes.puts.length > 0 || nearbyStrikes.calls.length > 0) {
    selection.nearbyStrikes = nearbyStrikes;
    reasoning.addLogicStep(
      `Collected ${nearbyStrikes.puts.length} nearby PUT strikes and ${nearbyStrikes.calls.length} nearby CALL strikes for comparison`
    );
  }

  // Step 3.5: Build summary
  const dataSource = usingRealData ? 'IBKR real-time' : 'mock estimates';

  // Calculate confidence based on data quality and range matching
  let confidence = 0.7; // Base confidence
  if (usingRealData) confidence += 0.15;
  if (selection.putStrike || selection.callStrike) confidence += 0.10;
  // Check if all selected strikes are within target delta range
  const putInRange = selection.putStrike
    ? selection.putStrike.delta >= deltaTarget.min && selection.putStrike.delta <= deltaTarget.max
    : true;
  const callInRange = selection.callStrike
    ? selection.callStrike.delta >= deltaTarget.min && selection.callStrike.delta <= deltaTarget.max
    : true;
  if (putInRange && callInRange) confidence += 0.05;
  confidence = Math.min(confidence, 1);

  // Build short reason for display
  const strikesSummary: string[] = [];
  if (selection.putStrike) {
    strikesSummary.push(`PUT $${selection.putStrike.strike} (δ${formatNumber(selection.putStrike.delta, 2)})`);
  }
  if (selection.callStrike) {
    strikesSummary.push(`CALL $${selection.callStrike.strike} (δ${formatNumber(selection.callStrike.delta, 2)})`);
  }

  selection.reason = strikesSummary.length > 0
    ? `${strikesSummary.join(', ')} | Premium: ${formatCurrency(selection.expectedPremium)} | ${dataSource}`
    : 'No strikes selected';

  // Build final reasoning
  const decisionEmoji = strikesSummary.length > 0 ? '✅' : '❌';
  const finalReasoning = reasoning.build(
    strikesSummary.length > 0
      ? `STRIKES SELECTED: ${strikesSummary.join(', ')}. Expected premium: ${formatCurrency(selection.expectedPremium)}`
      : 'NO STRIKES SELECTED: Unable to find suitable options',
    decisionEmoji,
    confidence * 100,
    strikesSummary.length > 0
  );

  selection.reasoning = finalReasoning;

  return selection;
}

