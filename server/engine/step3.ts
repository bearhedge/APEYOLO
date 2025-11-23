/**
 * Step 3: Strike Selection
 * Selects optimal strike prices based on delta targeting (0.15-0.20)
 *
 * Current implementation: Mock strike selection
 * Future: Use real option chain data from IBKR
 */

import { TradeDirection } from './step2';

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
  reasoning: string;
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
 * Main function: Select optimal strikes based on delta targeting
 * @param direction - Trade direction from Step 2
 * @param underlyingPrice - Current price of underlying (mock or real)
 * @returns Selected strikes with expected premium
 */
export async function selectStrikes(
  direction: TradeDirection,
  underlyingPrice: number = 450 // Default SPY price for testing
): Promise<StrikeSelection> {
  const selection: StrikeSelection = {
    expectedPremium: 0,
    marginRequired: 0,
    reasoning: ''
  };

  // Get option chains (mock for now, real IBKR data later)
  if (direction === 'PUT' || direction === 'STRANGLE') {
    const putChain = getMockOptionChain(underlyingPrice, 'PUT');
    const putStrike = findBestStrike(putChain);

    if (putStrike) {
      selection.putStrike = putStrike;
      selection.reasoning += `PUT: Strike $${putStrike.strike} with delta ${putStrike.delta}. `;
    }
  }

  if (direction === 'CALL' || direction === 'STRANGLE') {
    const callChain = getMockOptionChain(underlyingPrice, 'CALL');
    const callStrike = findBestStrike(callChain);

    if (callStrike) {
      selection.callStrike = callStrike;
      selection.reasoning += `CALL: Strike $${callStrike.strike} with delta ${callStrike.delta}. `;
    }
  }

  // Calculate totals
  selection.expectedPremium = calculateExpectedPremium(selection.putStrike, selection.callStrike);
  selection.marginRequired = calculateMarginRequirement(selection.putStrike, selection.callStrike);

  // Add summary to reasoning
  selection.reasoning += `Expected premium: $${selection.expectedPremium}, Margin required: $${selection.marginRequired}`;

  return selection;
}

