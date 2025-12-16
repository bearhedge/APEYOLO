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
import type {
  SmartStrikeCandidate,
  StrikeRejection,
  SmartFilterConfig,
  QualityRating
} from '../../shared/types/engine';

// Expiration modes for different symbols
export type ExpirationMode = '0DTE' | 'WEEKLY';

/**
 * Calculate expiration date based on mode
 * @param mode - '0DTE' for same-day or 'WEEKLY' for next Friday
 * @returns Expiration date
 */
export function getExpirationDate(mode: ExpirationMode): Date {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));

  if (mode === '0DTE') {
    // Same day expiration (4 PM ET close)
    const expiration = new Date(et);
    expiration.setHours(16, 0, 0, 0);
    return expiration;
  } else {
    // WEEKLY: Next Friday (or today if Friday before market close)
    const dayOfWeek = et.getDay(); // 0=Sun, 5=Fri
    let daysUntilFriday: number;

    if (dayOfWeek === 5) {
      // It's Friday - use today if before 4PM ET
      const currentHour = et.getHours();
      if (currentHour < 16) {
        daysUntilFriday = 0; // Today
      } else {
        daysUntilFriday = 7; // Next Friday
      }
    } else if (dayOfWeek === 6) {
      // Saturday - next Friday is 6 days away
      daysUntilFriday = 6;
    } else {
      // Sun-Thu: calculate days until Friday
      daysUntilFriday = (5 - dayOfWeek + 7) % 7;
      if (daysUntilFriday === 0) daysUntilFriday = 7; // Should not happen but safety check
    }

    const expiration = new Date(et);
    expiration.setDate(expiration.getDate() + daysUntilFriday);
    expiration.setHours(16, 0, 0, 0);
    return expiration;
  }
}

/**
 * Get expiration date string in YYYYMMDD format for IBKR
 */
export function getExpirationString(mode: ExpirationMode): string {
  const expDate = getExpirationDate(mode);
  const year = expDate.getFullYear();
  const month = String(expDate.getMonth() + 1).padStart(2, '0');
  const day = String(expDate.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

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
  // Risk assessment - dynamic delta and position sizing based on VIX
  riskAssessment?: RiskAssessment;
  // Enhanced logging for UI
  stepReasoning?: StepReasoning[];
  stepMetrics?: StepMetric[];
  enhancedNearbyStrikes?: NearbyStrike[];  // Flat array for UI table display

  // Smart Strike Selection (Interactive UI)
  smartCandidates?: {
    puts: SmartStrikeCandidate[];
    calls: SmartStrikeCandidate[];
  };
  rejectedStrikes?: StrikeRejection[];
  filterConfig?: SmartFilterConfig;
  awaitingUserSelection?: boolean;
}

/**
 * Risk Assessment based on VIX levels
 * Determines target delta and position sizing dynamically
 */
export type RiskRegime = 'LOW' | 'NORMAL' | 'ELEVATED' | 'HIGH' | 'EXTREME';

export interface RiskAssessment {
  vixLevel: number;
  riskRegime: RiskRegime;
  targetDelta: number;
  contracts: number;
  reasoning: string;
}

/**
 * Assess risk based on VIX and determine target delta + position size
 *
 * Delta target is always 0.20 (strictly below 0.30)
 * Contract sizing: Simple formula based on buying power / margin per contract
 *
 * @param vix - Current VIX level
 * @param underlyingPrice - Underlying price in USD (for margin calculation)
 * @param cash - Account cash/netLiquidation in HKD (NOT buying power)
 * @param symbol - Underlying symbol (for ETF vs stock margin rate)
 */
export function assessRisk(
  vix: number,
  underlyingPrice?: number,
  cash?: number,
  symbol?: string
): RiskAssessment {
  let riskRegime: RiskRegime;
  let targetDelta: number;
  let contracts: number;
  let reasoning: string;

  // Determine VIX regime AND dynamic delta target
  // LOW/NORMAL: Higher delta (0.175) = more premium, closer to ATM
  // ELEVATED/HIGH: Lower delta (0.125) = safer, further OTM
  // EXTREME: No trading
  if (vix < 17) {
    riskRegime = 'LOW';
    targetDelta = 0.175; // Target 0.15-0.20 range
  } else if (vix < 20) {
    riskRegime = 'NORMAL';
    targetDelta = 0.175; // Target 0.15-0.20 range
  } else if (vix < 25) {
    riskRegime = 'ELEVATED';
    targetDelta = 0.125; // Target 0.10-0.15 range (safer)
  } else if (vix < 35) {
    riskRegime = 'HIGH';
    targetDelta = 0.125; // Target 0.10-0.15 range (safer)
  } else {
    riskRegime = 'EXTREME';
    targetDelta = 0; // No trading
  }

  // Calculate contracts from cash (simple formula)
  if (cash && underlyingPrice && symbol && underlyingPrice > 0 && cash > 0) {
    contracts = calculateMaxContracts(underlyingPrice, cash, symbol);
    const isETF = ETF_SYMBOLS.includes(symbol);
    const marginRate = isETF ? ETF_MARGIN_RATE : STOCK_MARGIN_RATE;
    const marginPerContract = underlyingPrice * 100 * USD_TO_HKD * marginRate;
    const deltaRange = riskRegime === 'LOW' || riskRegime === 'NORMAL' ? '0.15-0.20' : '0.10-0.15';
    reasoning = `VIX ${vix.toFixed(1)} (${riskRegime}): ${contracts} contracts, delta ${deltaRange} (cash $${(cash/1000).toFixed(0)}k ÷ $${(marginPerContract/1000).toFixed(0)}k margin)`;
  } else {
    // Fallback: 2 for SPY, 5 for others (legacy behavior)
    contracts = symbol === 'SPY' ? 2 : 5;
    const deltaRange = riskRegime === 'LOW' || riskRegime === 'NORMAL' ? '0.15-0.20' : '0.10-0.15';
    reasoning = `VIX ${vix.toFixed(1)} (${riskRegime}): ${contracts} contracts, delta ${deltaRange} (fallback - no cash data)`;
  }

  // EXTREME VIX = no trading
  if (riskRegime === 'EXTREME') {
    contracts = 0;
    reasoning = `VIX ${vix.toFixed(1)} >= 35: EXTREME risk → NO TRADE`;
  }

  return { vixLevel: vix, riskRegime, targetDelta, contracts, reasoning };
}

/**
 * Get delta target ranges based on risk assessment
 * Returns ranges with ±0.05 tolerance around the target
 */
function getDeltaTargets(targetDelta: number): {
  put: { min: number; max: number; ideal: number };
  call: { min: number; max: number; ideal: number };
} {
  return {
    // PUT deltas are negative
    put: {
      min: -(targetDelta + 0.05),  // e.g., -0.45 for 0.40 target
      max: -(targetDelta - 0.05),  // e.g., -0.35 for 0.40 target
      ideal: -targetDelta          // e.g., -0.40
    },
    // CALL deltas are positive
    call: {
      min: targetDelta - 0.05,     // e.g., 0.35 for 0.40 target
      max: targetDelta + 0.05,     // e.g., 0.45 for 0.40 target
      ideal: targetDelta           // e.g., 0.40
    }
  };
}

// Default delta targets - consistent with mandate (0.10-0.20)
const DEFAULT_TARGET_DELTA = 0.15;
const PUT_DELTA_TARGET = { min: -0.20, max: -0.10, ideal: -0.15 };
const CALL_DELTA_TARGET = { min: 0.10, max: 0.20, ideal: 0.15 };

// =============================================================================
// Dynamic Contract Sizing (HKD Account)
// =============================================================================
// Simple formula: max_contracts = floor(buying_power / margin_per_contract)
// margin_per_contract = underlying_price × 100 × USD_TO_HKD × margin_rate

const USD_TO_HKD = 7.8;

// Margin rates calibrated from user-verified data:
// ARM: 5 contracts @ $150k cash → $30k/contract → 27.5% margin
// SPY: 2 contracts @ $150k cash @ ~$608 → $75k/contract → 15.5% margin
const STOCK_MARGIN_RATE = 0.270;  // 27.0% for stocks (calibrated for ARM = 5 contracts)
const ETF_MARGIN_RATE = 0.155;    // 15.5% for ETFs (calibrated for SPY = 2 contracts)
const ETF_SYMBOLS = ['SPY', 'QQQ', 'IWM', 'DIA'];

/**
 * Calculate maximum contracts based on CASH and margin requirements
 * Margin is calculated from cash (net liquidation), NOT buying power
 *
 * User-verified values (HKD account, ~$150k cash):
 * - ARM $140: ~$30,000 HKD margin/contract → 5 contracts max
 * - SPY $600: ~$75,000 HKD margin/contract → 2 contracts max
 *
 * @param underlyingPrice - Current price in USD
 * @param cash - Account cash/netLiquidation in HKD (NOT buying power)
 * @param symbol - Underlying symbol (to determine ETF vs stock margin rate)
 * @returns Maximum number of contracts
 */
export function calculateMaxContracts(
  underlyingPrice: number,
  cash: number,
  symbol: string
): number {
  const isETF = ETF_SYMBOLS.includes(symbol);
  const marginRate = isETF ? ETF_MARGIN_RATE : STOCK_MARGIN_RATE;
  const marginPerContract = underlyingPrice * 100 * USD_TO_HKD * marginRate;
  const maxContracts = Math.floor(cash / marginPerContract);

  console.log(`[Step3] calculateMaxContracts: ${symbol} @ $${underlyingPrice}, cash=$${cash.toLocaleString()} HKD`);
  console.log(`[Step3]   isETF=${isETF}, marginRate=${marginRate}, marginPerContract=$${marginPerContract.toLocaleString()} HKD`);
  console.log(`[Step3]   maxContracts=${maxContracts}`);

  return maxContracts;
}

// Legacy constants for backward compatibility (absolute values)
const TARGET_DELTA_MIN = 0.10;
const TARGET_DELTA_MAX = 0.25;
const TARGET_DELTA_IDEAL = 0.20;

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
 * @param customTarget - Optional custom delta target (from risk assessment)
 * @returns Best matching strike
 */
function findBestStrike(
  strikes: Strike[],
  direction: 'PUT' | 'CALL',
  customTarget?: { min: number; max: number; ideal: number }
): Strike | null {
  // Use custom target if provided, otherwise fall back to defaults
  const deltaTarget = customTarget || (direction === 'PUT' ? PUT_DELTA_TARGET : CALL_DELTA_TARGET);

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

  console.log(`[Step3] findBestStrike(${direction}): ${strikes.length} total strikes, ${validStrikes.length} in target range [${deltaTarget.min.toFixed(2)}, ${deltaTarget.max.toFixed(2)}]`);

  if (validStrikes.length === 0) {
    // If no strikes in range, find closest one to ideal
    console.log(`[Step3] No strikes in target range, finding closest to ideal ${deltaTarget.ideal.toFixed(2)}`);
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

// =============================================================================
// Smart Strike Filtering & Quality Scoring
// =============================================================================

// Default smart filter configuration
const DEFAULT_SMART_FILTER: SmartFilterConfig = {
  deltaMin: 0.05,         // Minimum delta (exclude ultra-far OTM)
  deltaMax: 0.25,         // Maximum delta (exclude ATM/ITM)
  minBid: 0.01,           // Minimum bid price
  maxSpread: 0.10,        // Maximum bid-ask spread for SPY
  minLiquidity: 100,      // Minimum OI + Volume
  minYield: 0.0003,       // Minimum yield 0.03% (premium / underlying)
};

// ATM range for strike display (±$8 from underlying)
const ATM_RANGE = 8;

/**
 * Calculate quality score (1-5 stars) based on strike metrics
 */
function calculateQualityScore(
  strike: Strike,
  underlyingPrice: number,
  config: SmartFilterConfig
): { score: QualityRating; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const absDelta = Math.abs(strike.delta);
  const spread = strike.ask - strike.bid;
  const premium = (strike.bid + strike.ask) / 2;
  const yieldPct = premium / underlyingPrice;
  const oi = strike.openInterest ?? 0;

  // Delta scoring (sweet spot: 0.10-0.16)
  if (absDelta >= 0.10 && absDelta <= 0.16) {
    score += 2;
    reasons.push(`⭐ Sweet spot delta (${absDelta.toFixed(2)})`);
  } else if (absDelta >= 0.08 && absDelta <= 0.20) {
    score += 1;
    reasons.push(`✓ Good delta (${absDelta.toFixed(2)})`);
  }

  // Spread scoring (tight = better)
  if (spread <= 0.03) {
    score += 2;
    reasons.push(`⭐ Very tight spread ($${spread.toFixed(2)})`);
  } else if (spread <= 0.05) {
    score += 1;
    reasons.push(`✓ Tight spread ($${spread.toFixed(2)})`);
  }

  // Yield scoring (higher = better)
  if (yieldPct >= 0.0005) {  // 0.05%+
    score += 2;
    reasons.push(`⭐ Excellent yield (${(yieldPct * 100).toFixed(3)}%)`);
  } else if (yieldPct >= 0.0003) {  // 0.03%+
    score += 1;
    reasons.push(`✓ Good yield (${(yieldPct * 100).toFixed(3)}%)`);
  }

  // Liquidity scoring (OI)
  if (oi >= 5000) {
    score += 1;
    reasons.push(`✓ High liquidity (${oi.toLocaleString()} OI)`);
  } else if (oi >= 1000) {
    reasons.push(`○ Moderate liquidity (${oi.toLocaleString()} OI)`);
  }

  // Clamp to 1-5
  const finalScore = Math.max(1, Math.min(5, score)) as QualityRating;
  return { score: finalScore, reasons };
}

/**
 * Filter strikes using smart criteria and return candidates + rejections
 */
function filterSmartStrikes(
  strikes: Strike[],
  optionType: 'PUT' | 'CALL',
  underlyingPrice: number,
  config: SmartFilterConfig,
  engineRecommendedStrike?: number
): { candidates: SmartStrikeCandidate[]; rejections: StrikeRejection[] } {
  const candidates: SmartStrikeCandidate[] = [];
  const rejections: StrikeRejection[] = [];

  // Get strike range based on ATM (±$8)
  const atm = Math.round(underlyingPrice);
  let minStrike: number, maxStrike: number;

  if (optionType === 'PUT') {
    // PUTs are below ATM
    minStrike = atm - ATM_RANGE;
    maxStrike = atm - 1;
  } else {
    // CALLs are above ATM
    minStrike = atm + 1;
    maxStrike = atm + ATM_RANGE;
  }

  for (const strike of strikes) {
    // Skip strikes outside ATM range
    if (strike.strike < minStrike || strike.strike > maxStrike) {
      continue;
    }

    const absDelta = Math.abs(strike.delta);
    const spread = strike.ask - strike.bid;
    const premium = (strike.bid + strike.ask) / 2;
    const yieldValue = premium / underlyingPrice;
    const oi = strike.openInterest ?? 0;

    // Apply filters
    let rejected = false;
    let rejectionReason: StrikeRejection['reason'] | null = null;
    let rejectionDetails = '';

    // 1. Delta filter
    if (absDelta < config.deltaMin || absDelta > config.deltaMax) {
      rejected = true;
      rejectionReason = 'DELTA_OUT_OF_RANGE';
      rejectionDetails = `Delta ${absDelta.toFixed(2)} outside range [${config.deltaMin}, ${config.deltaMax}]`;
    }

    // 2. Bid filter
    if (!rejected && strike.bid < config.minBid) {
      rejected = true;
      rejectionReason = 'BID_TOO_LOW';
      rejectionDetails = `Bid $${strike.bid.toFixed(2)} < minimum $${config.minBid}`;
    }

    // 3. Spread filter
    if (!rejected && spread > config.maxSpread) {
      rejected = true;
      rejectionReason = 'SPREAD_TOO_WIDE';
      rejectionDetails = `Spread $${spread.toFixed(2)} > maximum $${config.maxSpread}`;
    }

    // 4. Yield filter
    if (!rejected && yieldValue < config.minYield) {
      rejected = true;
      rejectionReason = 'YIELD_TOO_LOW';
      rejectionDetails = `Yield ${(yieldValue * 100).toFixed(3)}% < minimum ${(config.minYield * 100).toFixed(3)}%`;
    }

    // 5. Liquidity filter (OI only - volume not available from IBKR)
    if (!rejected && oi < config.minLiquidity) {
      rejected = true;
      rejectionReason = 'ILLIQUID';
      rejectionDetails = `OI ${oi} < minimum ${config.minLiquidity}`;
    }

    if (rejected && rejectionReason) {
      rejections.push({
        strike: strike.strike,
        optionType,
        reason: rejectionReason,
        details: rejectionDetails
      });
    } else {
      // Calculate quality score
      const { score, reasons } = calculateQualityScore(strike, underlyingPrice, config);

      candidates.push({
        strike: strike.strike,
        optionType,
        bid: strike.bid,
        ask: strike.ask,
        spread,
        delta: strike.delta,
        gamma: strike.gamma,
        theta: strike.theta,
        vega: strike.vega,
        iv: strike.impliedVolatility,
        openInterest: oi,
        volume: undefined, // Not available from IBKR
        yield: yieldValue,
        yieldPct: `${(yieldValue * 100).toFixed(3)}%`,
        qualityScore: score,
        qualityReasons: reasons,
        isEngineRecommended: strike.strike === engineRecommendedStrike,
        isUserSelected: false
      });
    }
  }

  // Sort by quality score (descending), then by yield
  candidates.sort((a, b) => {
    if (b.qualityScore !== a.qualityScore) {
      return b.qualityScore - a.qualityScore;
    }
    return b.yield - a.yield;
  });

  return { candidates, rejections };
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
async function fetchFullOptionChain(symbol: string, expirationStr?: string): Promise<FullOptionChainResult | null> {
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
    console.log(`[Step3] Requesting expiration: ${expirationStr || 'default (today)'}`);
    const chainData = await getOptionChainWithStrikes(symbol, expirationStr);

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
 * @param expirationMode - Expiration mode: '0DTE' for same-day, 'WEEKLY' for Friday
 * @param cash - Account cash/netLiquidation in HKD (for margin-based contract sizing)
 * @returns Selected strikes with expected premium
 */
export async function selectStrikes(
  direction: TradeDirection,
  underlyingPrice: number = 450, // Default SPY price for testing
  symbol: string = 'SPY',
  expirationMode: ExpirationMode = '0DTE',
  cash?: number
): Promise<StrikeSelection> {
  console.log(`[Step3] Strike Selection START`);
  console.log(`[Step3] Direction: ${direction}, Underlying fallback price: $${underlyingPrice.toFixed(2)}, Symbol: ${symbol}, Mode: ${expirationMode}`);

  // Calculate expiration based on mode
  const expirationDate = getExpirationDate(expirationMode);
  const expirationStr = getExpirationString(expirationMode);
  console.log(`[Step3] Expiration: ${expirationDate.toISOString().split('T')[0]} (${expirationMode})`);

  const selection: StrikeSelection = {
    expectedPremium: 0,
    marginRequired: 0,
    reasoning: ''
  };

  let actualUnderlyingPrice = underlyingPrice;
  let dataSource: 'websocket' | 'http' | 'mock' = 'mock';

  // CRITICAL: Fetch option chain ONCE and reuse for both PUT and CALL
  // This ensures consistent data source and avoids the bug where PUT uses IBKR but CALL uses mock
  console.log(`[Step3] Fetching option chain for ${symbol} with expiration ${expirationStr}...`);
  const chainStart = Date.now();
  const fullChain = await fetchFullOptionChain(symbol, expirationStr);
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

    // === RISK ASSESSMENT: Dynamic delta and position sizing based on VIX + buying power ===
    const vix = fullChain.vix ?? 20; // Default to 20 (ELEVATED) if VIX unavailable
    // Pass buying power for dynamic contract sizing
    const riskAssessment = assessRisk(vix, actualUnderlyingPrice, cash, symbol);
    selection.riskAssessment = riskAssessment;
    console.log(`[Step3] RISK ASSESSMENT: ${riskAssessment.reasoning}`);

    // Check for EXTREME regime - do not trade
    if (riskAssessment.riskRegime === 'EXTREME') {
      console.warn(`[Step3] EXTREME risk regime (VIX ${vix}) - NO TRADE recommended`);
      selection.reasoning = `NO TRADE: ${riskAssessment.reasoning}`;
      // Still return selection with risk assessment but no strikes selected
      return selection;
    }

    // Get dynamic delta targets based on risk assessment
    const dynamicTargets = getDeltaTargets(riskAssessment.targetDelta);
    console.log(`[Step3] Dynamic delta targets: PUT [${dynamicTargets.put.min.toFixed(2)}, ${dynamicTargets.put.max.toFixed(2)}], CALL [${dynamicTargets.call.min.toFixed(2)}, ${dynamicTargets.call.max.toFixed(2)}]`);

    // Select PUT strike from real data (PUTs have NEGATIVE delta)
    if (direction === 'PUT' || direction === 'STRANGLE') {
      if (fullChain.putStrikes.length > 0) {
        const putStrike = findBestStrike(fullChain.putStrikes, 'PUT', dynamicTargets.put);
        if (putStrike) {
          selection.putStrike = putStrike;
          console.log(`[Step3] Selected PUT: $${putStrike.strike} (delta: ${putStrike.delta.toFixed(3)}, bid: $${putStrike.bid.toFixed(2)}, ask: $${putStrike.ask.toFixed(2)})`);
          selection.reasoning += `PUT (IBKR ${dataSource}): Strike $${putStrike.strike} with delta ${putStrike.delta.toFixed(3)}. `;
        } else {
          console.error(`[Step3] Failed to find PUT strike matching delta target ${dynamicTargets.put.ideal}`);
        }
      } else {
        console.error(`[Step3] No PUT strikes in option chain`);
        throw new Error('[IBKR] No PUT strikes available - cannot proceed without real option data');
      }
    }

    // Select CALL strike from real data (CALLs have POSITIVE delta)
    if (direction === 'CALL' || direction === 'STRANGLE') {
      if (fullChain.callStrikes.length > 0) {
        const callStrike = findBestStrike(fullChain.callStrikes, 'CALL', dynamicTargets.call);
        if (callStrike) {
          selection.callStrike = callStrike;
          console.log(`[Step3] Selected CALL: $${callStrike.strike} (delta: ${callStrike.delta.toFixed(3)}, bid: $${callStrike.bid.toFixed(2)}, ask: $${callStrike.ask.toFixed(2)})`);
          selection.reasoning += `CALL (IBKR ${dataSource}): Strike $${callStrike.strike} with delta ${callStrike.delta.toFixed(3)}. `;
        } else {
          console.error(`[Step3] Failed to find CALL strike matching delta target ${dynamicTargets.call.ideal}`);
        }
      } else {
        console.error(`[Step3] No CALL strikes in option chain`);
        throw new Error('[IBKR] No CALL strikes available - cannot proceed without real option data');
      }
    }

    // Collect nearby strikes for UI display from the same data source
    // ALWAYS show BOTH puts AND calls regardless of direction
    // Use ATM-centered range (±$8 from underlying) for smart filtering
    const nearbyStrikes: {
      puts: Array<{ strike: number; bid: number; ask: number; delta: number; oi?: number }>;
      calls: Array<{ strike: number; bid: number; ask: number; delta: number; oi?: number }>;
    } = { puts: [], calls: [] };

    // Define ATM range - show strikes within $8 of underlying price
    const atm = Math.round(actualUnderlyingPrice);
    const minStrikeNearby = atm - ATM_RANGE;
    const maxStrikeNearby = atm + ATM_RANGE;
    console.log(`[Step3] ATM range: $${minStrikeNearby} - $${maxStrikeNearby} (underlying: $${actualUnderlyingPrice.toFixed(2)}, ATM_RANGE: ${ATM_RANGE})`);

    // ALWAYS populate PUT strikes (below ATM within range)
    {
      const atmPuts = fullChain.putStrikes
        .filter(s => s.strike >= minStrikeNearby && s.strike < actualUnderlyingPrice)
        .sort((a, b) => b.strike - a.strike) // Highest strikes first (closest to ATM)
        .slice(0, ATM_RANGE); // Up to 8 strikes below ATM

      nearbyStrikes.puts = atmPuts.map(s => ({
        strike: s.strike,
        bid: s.bid,
        ask: s.ask,
        delta: s.delta,
        oi: s.openInterest
      })).sort((a, b) => a.strike - b.strike); // Sort ascending for display
      console.log(`[Step3] ATM Puts: ${nearbyStrikes.puts.map(p => `$${p.strike}`).join(', ')}`);
    }

    // ALWAYS populate CALL strikes (above ATM within range)
    {
      const atmCalls = fullChain.callStrikes
        .filter(s => s.strike > actualUnderlyingPrice && s.strike <= maxStrikeNearby)
        .sort((a, b) => a.strike - b.strike) // Lowest strikes first (closest to ATM)
        .slice(0, ATM_RANGE); // Up to 8 strikes above ATM

      nearbyStrikes.calls = atmCalls.map(s => ({
        strike: s.strike,
        bid: s.bid,
        ask: s.ask,
        delta: s.delta,
        oi: s.openInterest
      })).sort((a, b) => a.strike - b.strike); // Sort ascending for display
      console.log(`[Step3] ATM Calls: ${nearbyStrikes.calls.map(c => `$${c.strike}`).join(', ')}`);
    }

    if (nearbyStrikes.puts.length > 0 || nearbyStrikes.calls.length > 0) {
      selection.nearbyStrikes = nearbyStrikes;
    }

    // === SMART STRIKE FILTERING ===
    // Apply intelligent filtering for "elite" strikes with quality scoring
    const smartFilterConfig = DEFAULT_SMART_FILTER;
    selection.filterConfig = smartFilterConfig;

    // Filter PUTs with smart criteria
    const smartPuts = filterSmartStrikes(
      fullChain.putStrikes,
      'PUT',
      actualUnderlyingPrice,
      smartFilterConfig,
      selection.putStrike?.strike
    );

    // Filter CALLs with smart criteria
    const smartCalls = filterSmartStrikes(
      fullChain.callStrikes,
      'CALL',
      actualUnderlyingPrice,
      smartFilterConfig,
      selection.callStrike?.strike
    );

    // Populate smart candidates
    selection.smartCandidates = {
      puts: smartPuts.candidates,
      calls: smartCalls.candidates
    };

    // Collect all rejections
    selection.rejectedStrikes = [...smartPuts.rejections, ...smartCalls.rejections];

    console.log(`[Step3] Smart filtering: ${smartPuts.candidates.length} viable PUTs, ${smartCalls.candidates.length} viable CALLs`);
    console.log(`[Step3] Rejected strikes: ${selection.rejectedStrikes.length}`);

    // Log top candidates
    if (smartPuts.candidates.length > 0) {
      const topPut = smartPuts.candidates[0];
      console.log(`[Step3] Top PUT: $${topPut.strike} (${topPut.qualityScore}⭐, yield: ${topPut.yieldPct}, delta: ${topPut.delta.toFixed(2)})`);
    }
    if (smartCalls.candidates.length > 0) {
      const topCall = smartCalls.candidates[0];
      console.log(`[Step3] Top CALL: $${topCall.strike} (${topCall.qualityScore}⭐, yield: ${topCall.yieldPct}, delta: ${topCall.delta.toFixed(2)})`);
    }

    // Set awaiting user selection flag for gated flow
    selection.awaitingUserSelection = true;

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
  const riskInfo = selection.riskAssessment;
  const targetDeltaValue = riskInfo?.targetDelta ?? DEFAULT_TARGET_DELTA;

  selection.stepReasoning = [
    {
      question: 'Risk regime?',
      answer: riskInfo
        ? `${riskInfo.riskRegime} (VIX: ${riskInfo.vixLevel.toFixed(1)})`
        : 'UNKNOWN (VIX unavailable)'
    },
    {
      question: 'What delta are we targeting?',
      answer: `~${targetDeltaValue.toFixed(2)} delta (based on ${riskInfo?.riskRegime ?? 'default'} risk)`
    },
    {
      question: 'Position size?',
      answer: riskInfo
        ? `${riskInfo.contracts} contract(s)`
        : '1 contract (default)'
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
  const deltaMin = targetDeltaValue - 0.05;
  const deltaMax = targetDeltaValue + 0.05;

  selection.stepMetrics = [
    {
      label: 'Risk Regime',
      value: riskInfo?.riskRegime ?? 'N/A',
      status: riskInfo?.riskRegime === 'EXTREME' ? 'critical' :
              riskInfo?.riskRegime === 'HIGH' ? 'warning' : 'normal'
    },
    {
      label: 'Contracts',
      value: riskInfo ? `${riskInfo.contracts}` : '1',
      status: 'normal'
    },
    {
      label: 'Selected Strike',
      value: selectedStrike ? `$${selectedStrike.strike}` : 'N/A',
      status: selectedStrike ? 'normal' : 'critical'
    },
    {
      label: 'Delta',
      value: selectedStrike ? selectedStrike.delta.toFixed(3) : 'N/A',
      status: selectedStrike
        ? (Math.abs(selectedStrike.delta) >= deltaMin &&
           Math.abs(selectedStrike.delta) <= deltaMax
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
      value: selection.riskAssessment
        ? `$${(selection.expectedPremium * selection.riskAssessment.contracts).toFixed(2)} (${selection.riskAssessment.contracts} × $${selection.expectedPremium.toFixed(2)})`
        : `$${selection.expectedPremium.toFixed(2)}`,
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

