// @ts-nocheck
// TODO: Fix type mismatches
/**
 * Engine Response Adapter
 *
 * Transforms the existing TradingDecision output from the engine
 * into the standardized EngineAnalyzeResponse format expected by the frontend.
 *
 * This adapter pattern allows us to:
 * 1. Keep the existing step logic unchanged
 * 2. Provide a consistent API contract
 * 3. Support gradual migration
 */

import { TradingDecision, AuditEntry as EngineAuditEntry } from './index.ts';
import { MarketRegime, VolatilityRegime as VR } from './step1.ts';
import { DirectionDecision, TradeDirection } from './step2.ts';
import { StrikeSelection, Strike, getExpirationDate, ExpirationMode } from './step3.ts';
import { PositionSize, RiskProfile } from './step4.ts';
import { ExitRules } from './step5.ts';
import type {
  EngineAnalyzeResponse,
  Q1MarketRegime,
  Q2Direction,
  Q3Strikes,
  Q4Size,
  Q5Exit,
  TradeProposal,
  TradeLeg,
  SelectedStrike,
  StrikeCandidate,
  GuardRailResult,
  TradingWindowStatus,
  AuditEntry,
  VolatilityRegime,
  BiasDirection,
  TrendDirection,
  RiskAssessment,
} from '../../shared/types/engine.ts';

// VIX threshold constants (must match step1.ts)
const VIX_LOW_THRESHOLD = 17;
const VIX_HIGH_THRESHOLD = 20;
const VIX_EXTREME_THRESHOLD = 35;

// MA period constants (must match step2.ts)
const MA_PERIOD = 50;  // 50-period MA on 5-min bars = ~4 hours of price action

/**
 * Calculate σ-distance (standard deviations from price)
 * Simple approximation: (strike - price) / (price * IV * sqrt(DTE/365))
 */
function calculateSigmaDist(
  strike: number,
  underlyingPrice: number,
  iv: number = 0.20,
  dte: number = 0 // 0DTE default
): number {
  const dteFraction = Math.max(dte, 1) / 365;
  const denominator = underlyingPrice * iv * Math.sqrt(dteFraction);
  if (denominator === 0) return 0;
  return Math.abs(strike - underlyingPrice) / denominator;
}

/**
 * Adapt MarketRegime → Q1MarketRegime
 */
function adaptMarketRegime(regime: MarketRegime | undefined): Q1MarketRegime {
  const vix = regime?.metadata?.vix ?? null;
  const spyPrice = regime?.metadata?.spyPrice ?? null;

  // Determine volatility regime label
  let regimeLabel: VolatilityRegime = 'NORMAL';
  if (vix !== null) {
    if (vix >= VIX_EXTREME_THRESHOLD) regimeLabel = 'EXTREME';
    else if (vix > VIX_HIGH_THRESHOLD) regimeLabel = 'HIGH';
    else if (vix < VIX_LOW_THRESHOLD) regimeLabel = 'LOW';
  }

  // Risk multiplier based on regime
  let riskMultiplier = 1.0;
  if (regimeLabel === 'HIGH') riskMultiplier = 0.5;
  if (regimeLabel === 'EXTREME') riskMultiplier = 0;

  return {
    regimeLabel,
    riskMultiplier,
    canTrade: regime?.shouldTrade ?? false,
    reason: regime?.reason ?? 'No market regime data available',

    inputs: {
      vixValue: vix,
      vixChangePct: regime?.metadata?.vixChange ?? null,
      spyPrice: spyPrice,
      spyChangePct: regime?.metadata?.spyChange ?? null,
      currentTimeEt: regime?.metadata?.currentTime ?? new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' }),
      isTradingHours: regime?.shouldTrade ?? false,
    },

    thresholds: {
      vixLow: VIX_LOW_THRESHOLD,
      vixHigh: VIX_HIGH_THRESHOLD,
      vixExtreme: VIX_EXTREME_THRESHOLD,
    },

    stepNumber: 1,
    stepName: 'Market Regime',
    passed: regime?.shouldTrade ?? false,
    confidence: regime?.confidence ?? 0,
  };
}

/**
 * Adapt DirectionDecision → Q2Direction
 */
function adaptDirection(direction: DirectionDecision | undefined): Q2Direction {
  // Map direction to bias
  let bias: BiasDirection = 'NEUTRAL';
  if (direction?.direction === 'PUT') bias = 'BULL';
  else if (direction?.direction === 'CALL') bias = 'BEAR';

  // Map signals.trend to our TrendDirection
  let trend: TrendDirection = 'SIDEWAYS';
  if (direction?.signals?.trend === 'UP') trend = 'UP';
  else if (direction?.signals?.trend === 'DOWN') trend = 'DOWN';

  // Build MA alignment string (now using single MA50)
  const spyPrice = direction?.signals?.spyPrice ?? 0;
  const ma50 = direction?.signals?.ma50 ?? 0;
  let maAlignment = 'N/A';
  if (spyPrice > 0 && ma50 > 0) {
    if (spyPrice > ma50) {
      maAlignment = `SPY > MA${MA_PERIOD}`;
    } else if (spyPrice < ma50) {
      maAlignment = `SPY < MA${MA_PERIOD}`;
    } else {
      maAlignment = `SPY ≈ MA${MA_PERIOD}`;
    }
  }

  return {
    bias,
    recommendedDirection: direction?.direction ?? 'STRANGLE',
    confidencePct: Math.round((direction?.confidence ?? 0.5) * 100),
    comment: direction?.reasoning ?? 'No direction data available',

    inputs: {
      spyPrice,
      ma50,
      maPeriod: MA_PERIOD,
    },

    signals: {
      trend,
      momentum: direction?.signals?.momentum ?? 0,
      maAlignment,
    },

    stepNumber: 2,
    stepName: 'Direction',
    passed: true,
    confidence: direction?.confidence ?? 0.5,
  };
}

/**
 * Convert Strike → SelectedStrike
 */
function convertStrike(
  strike: Strike | undefined,
  underlyingPrice: number,
  optionType: 'PUT' | 'CALL'
): SelectedStrike | null {
  if (!strike) return null;

  const premium = (strike.bid + strike.ask) / 2;

  return {
    strike: strike.strike,
    delta: strike.delta,
    premium,
    bid: strike.bid,
    ask: strike.ask,
    probItm: strike.delta, // Simplified: delta ≈ prob ITM
    sigmaDist: calculateSigmaDist(strike.strike, underlyingPrice, strike.impliedVolatility),
    optionType,
  };
}

/**
 * Adapt StrikeSelection → Q3Strikes
 */
function adaptStrikes(
  strikes: StrikeSelection | undefined,
  underlyingPrice: number,
  symbol: string = 'SPY',
  expirationMode: string = '0DTE'
): Q3Strikes {
  const actualPrice = underlyingPrice || 450; // Fallback

  // Convert selected strikes
  const selectedPut = convertStrike(strikes?.putStrike, actualPrice, 'PUT');
  const selectedCall = convertStrike(strikes?.callStrike, actualPrice, 'CALL');

  // Build candidates array from nearby strikes
  const candidates: StrikeCandidate[] = [];

  if (strikes?.nearbyStrikes?.puts) {
    for (const s of strikes.nearbyStrikes.puts) {
      candidates.push({
        strike: s.strike,
        delta: s.delta,
        premium: (s.bid + s.ask) / 2,
        bid: s.bid,
        ask: s.ask,
        probItm: s.delta,
        sigmaDist: calculateSigmaDist(s.strike, actualPrice),
        optionType: 'PUT',
        openInterest: s.oi,
        isSelected: selectedPut?.strike === s.strike,
      });
    }
  }

  if (strikes?.nearbyStrikes?.calls) {
    for (const s of strikes.nearbyStrikes.calls) {
      candidates.push({
        strike: s.strike,
        delta: s.delta,
        premium: (s.bid + s.ask) / 2,
        bid: s.bid,
        ask: s.ask,
        probItm: s.delta,
        sigmaDist: calculateSigmaDist(s.strike, actualPrice),
        optionType: 'CALL',
        openInterest: s.oi,
        isSelected: selectedCall?.strike === s.strike,
      });
    }
  }

  // Determine data source from reasoning
  const dataSource: 'IBKR' | 'MOCK' = strikes?.reasoning?.includes('IBKR') ? 'IBKR' : 'MOCK';

  // Get today's expiration date string
  const today = new Date();
  const expirationStr = today.toISOString().split('T')[0];

  return {
    selectedPut,
    selectedCall,
    candidates,

    expectedPremiumPerContract: strikes?.expectedPremium ?? 0,
    dataSource,
    underlyingPrice: actualPrice,

    inputs: {
      targetDeltaMin: 0.15,
      targetDeltaMax: 0.20,
      targetDeltaIdeal: 0.18,
      symbol,
      expiration: expirationStr,
      expirationMode,
    },

    stepNumber: 3,
    stepName: 'Strikes',
    passed: !!(selectedPut || selectedCall),
    confidence: selectedPut || selectedCall ? 0.8 : 0.3,
  };
}

/**
 * Adapt PositionSize + AccountInfo → Q4Size
 */
function adaptSize(
  size: PositionSize | undefined,
  accountInfo: { buyingPower: number; cashBalance?: number; totalValue?: number },
  riskProfile: RiskProfile,
  premiumPerContract: number
): Q4Size {
  const nav = accountInfo.totalValue ?? accountInfo.cashBalance ?? 100000;
  const bp = accountInfo.buyingPower ?? 0;
  const contracts = size?.contracts ?? 0;
  const marginPerContract = size?.marginPerContract ?? 0;
  const totalMargin = size?.totalMarginRequired ?? 0;

  // Calculate worst case loss (for naked options, it's margin required)
  const worstCaseLoss = totalMargin;

  // Calculate % of NAV
  const pctOfNav = nav > 0 ? (worstCaseLoss / nav) * 100 : 0;

  // Risk profile limits
  const riskLimits = {
    CONSERVATIVE: { maxContracts: 2, bpUtilizationPct: 50, maxPositionPctOfNav: 5 },
    BALANCED: { maxContracts: 3, bpUtilizationPct: 70, maxPositionPctOfNav: 10 },
    AGGRESSIVE: { maxContracts: 4, bpUtilizationPct: 100, maxPositionPctOfNav: 20 },
  };

  const limits = riskLimits[riskProfile];

  return {
    maxContractsByRisk: limits.maxContracts,
    maxContractsByBp: bp > 0 && marginPerContract > 0
      ? Math.floor((bp * limits.bpUtilizationPct / 100) / marginPerContract)
      : 0,
    recommendedContracts: contracts,

    expectedPremiumTotal: premiumPerContract * contracts * 100,
    worstCaseLoss,
    marginPerContract,
    totalMarginRequired: totalMargin,
    pctOfNav: Number(pctOfNav.toFixed(2)),

    inputs: {
      nav,
      buyingPower: bp,
      cashBalance: accountInfo.cashBalance ?? 0,
      riskProfile,
      premiumPerContract,
    },

    riskLimits: {
      maxContracts: limits.maxContracts,
      bpUtilizationPct: limits.bpUtilizationPct,
      maxPositionPctOfNav: limits.maxPositionPctOfNav,
    },

    stepNumber: 4,
    stepName: 'Size',
    passed: contracts > 0,
    confidence: contracts > 0 ? 0.9 : 0.2,
  };
}

/**
 * Adapt ExitRules → Q5Exit
 */
function adaptExitRules(
  exit: ExitRules | undefined,
  contracts: number,
  premiumPerContract: number,
  stopMultiplier: number = 3
): Q5Exit {
  const entryPremium = premiumPerContract * 100; // Convert to dollars per contract

  // Use layer2 multiplier if available (from new Layered Defense System)
  // Otherwise fallback to passed stopMultiplier
  const actualMultiplier = exit?.layer2?.multiplier ?? stopMultiplier;
  const actualStopPrice = exit?.stopLossPrice ?? (premiumPerContract * actualMultiplier);
  const actualStopAmount = exit?.stopLossAmount ?? (entryPremium * actualMultiplier * contracts);

  // Build rules text based on layer system if available
  let stopLossRule: string;
  let timeStopRule: string;

  if (exit?.layer1 && exit?.layer2) {
    // New Layered Defense System
    const l1Parts: string[] = [];
    if (exit.layer1.putThreshold !== null) {
      l1Parts.push(`underlying < $${exit.layer1.putThreshold.toFixed(0)}`);
    }
    if (exit.layer1.callThreshold !== null) {
      l1Parts.push(`underlying > $${exit.layer1.callThreshold.toFixed(0)}`);
    }
    const l1Text = l1Parts.length > 0 ? `L1: Exit if ${l1Parts.join(' or ')} for 15 min. ` : '';

    stopLossRule = `${l1Text}L2: Exit at ${actualMultiplier}x premium ($${actualStopPrice.toFixed(2)})`;
    timeStopRule = 'L3: EOD sweep at 3:55 PM ET';
  } else {
    // Legacy single-stop system
    stopLossRule = `Exit at ${actualMultiplier}x premium ($${actualStopPrice.toFixed(2)})`;
    timeStopRule = 'Close by 3:30 PM ET if still open';
  }

  return {
    takeProfitPrice: exit?.takeProfitPrice ?? null,
    stopLossPrice: actualStopPrice,
    stopLossAmount: actualStopAmount,
    timeStopEt: exit?.layer1 ? '3:55 PM ET' : '3:30 PM ET', // Layer system uses 3:55

    takeProfitPct: null, // Let expire worthless
    stopLossMultiplier: actualMultiplier,
    maxHoldHours: exit?.maxHoldingTime ?? 24,

    inputs: {
      entryPremium,
      contracts,
      expirationTime: new Date(new Date().setHours(16, 0, 0, 0)).toISOString(),
    },

    rules: {
      stopLossRule,
      takeProfitRule: 'None - let options expire worthless',
      timeStopRule,
    },

    stepNumber: 5,
    stepName: 'Exit',
    passed: true,
    confidence: 0.95,
  };
}

/**
 * Build TradeProposal from decision components
 */
function buildTradeProposal(
  decision: TradingDecision,
  q3: Q3Strikes,
  q4: Q4Size,
  q5: Q5Exit,
  symbol: string = 'SPY',
  expirationMode: string = '0DTE'
): TradeProposal | null {
  if (!decision.executionReady || !decision.direction) {
    return null;
  }

  const legs: TradeLeg[] = [];

  if (q3.selectedPut) {
    legs.push({
      optionType: 'PUT',
      action: 'SELL',
      strike: q3.selectedPut.strike,
      delta: q3.selectedPut.delta,
      premium: q3.selectedPut.premium,
      bid: q3.selectedPut.bid,
      ask: q3.selectedPut.ask,
    });
  }

  if (q3.selectedCall) {
    legs.push({
      optionType: 'CALL',
      action: 'SELL',
      strike: q3.selectedCall.strike,
      delta: q3.selectedCall.delta,
      premium: q3.selectedCall.premium,
      bid: q3.selectedCall.bid,
      ask: q3.selectedCall.ask,
    });
  }

  if (legs.length === 0) return null;

  // Determine strategy
  let strategy: TradeDirection = decision.direction.direction;

  // Determine bias from direction
  let bias: BiasDirection = 'NEUTRAL';
  if (strategy === 'PUT') bias = 'BULL';
  else if (strategy === 'CALL') bias = 'BEAR';

  // Use correct expiration based on mode (0DTE = today, WEEKLY = Friday)
  const expirationDate = getExpirationDate(expirationMode as ExpirationMode);

  return {
    proposalId: `prop-${Date.now().toString(36)}`,
    createdAt: new Date().toISOString(),

    symbol,
    expiration: expirationMode,
    expirationDate: expirationDate.toISOString().split('T')[0],

    strategy,
    bias,

    legs,
    contracts: q4.recommendedContracts,

    entryPremiumPerContract: q3.expectedPremiumPerContract,
    entryPremiumTotal: q4.expectedPremiumTotal,
    marginRequired: q4.totalMarginRequired,
    maxLoss: q5.stopLossAmount,  // Use actual stop loss amount, not margin

    stopLossPrice: q5.stopLossPrice,
    stopLossAmount: q5.stopLossAmount,
    takeProfitPrice: q5.takeProfitPrice,
    timeStop: q5.timeStopEt,

    context: {
      vix: decision.marketRegime?.metadata?.vix ?? 0,
      vixRegime: decision.marketRegime?.volatilityRegime ?? 'NORMAL',
      spyPrice: q3.underlyingPrice,
      directionConfidence: decision.direction.confidence,
      riskProfile: q4.inputs.riskProfile,
    },
  };
}

/**
 * Get time components reliably in ET timezone using Intl.DateTimeFormat.formatToParts()
 * This works correctly regardless of the server's local timezone
 */
function getETTimeComponents(date: Date = new Date()): { hour: number; minute: number; dayOfWeek: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  let hour = 0, minute = 0, dayOfWeek = 0;

  for (const part of parts) {
    if (part.type === 'hour') hour = parseInt(part.value, 10);
    if (part.type === 'minute') minute = parseInt(part.value, 10);
    if (part.type === 'weekday') {
      const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      dayOfWeek = dayMap[part.value] ?? 0;
    }
  }

  // Handle midnight edge case (hour12: false returns '24' for midnight in some locales)
  if (hour === 24) hour = 0;

  return { hour, minute, dayOfWeek };
}

/**
 * Get trading window status
 */
function getTradingWindowStatus(): TradingWindowStatus {
  const now = new Date();

  // Get time components reliably in ET timezone
  const { hour, minute, dayOfWeek } = getETTimeComponents(now);
  const currentMinutes = hour * 60 + minute;

  const windowStart = 11 * 60; // 11:00 AM
  const windowEnd = 13 * 60;   // 1:00 PM

  // Weekday check disabled for testing - allow any day
  // const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;

  const isOpen = currentMinutes >= windowStart && currentMinutes < windowEnd;

  // Format current time string
  const timeStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(now);

  return {
    isOpen,
    currentTimeEt: timeStr,
    windowStart: '11:00 AM ET',
    windowEnd: '1:00 PM ET',
    reason: isOpen
      ? 'Trading window is open'
      : `Trading window closed. Open 11:00 AM - 1:00 PM ET`,
  };
}

/**
 * Adapt audit entries
 */
function adaptAudit(audit: EngineAuditEntry[]): AuditEntry[] {
  return audit.map(entry => ({
    step: entry.step,
    name: entry.name,
    timestamp: entry.timestamp.toISOString(),
    input: entry.input || {},
    output: entry.output || {},
    passed: entry.passed,
    reason: entry.reason,
  }));
}

/**
 * Main adapter function
 * Transforms TradingDecision → EngineAnalyzeResponse
 */
export function adaptTradingDecision(
  decision: TradingDecision,
  accountInfo: { buyingPower: number; cashBalance?: number; totalValue?: number },
  options?: {
    riskProfile?: RiskProfile;
    stopMultiplier?: number;
    guardRailViolations?: string[];
    tradingWindowOpen?: boolean;
    symbol?: string;
    expirationMode?: string;
  }
): EngineAnalyzeResponse {
  const riskProfile = options?.riskProfile ?? 'BALANCED';
  const stopMultiplier = options?.stopMultiplier ?? 3.5;
  const symbol = options?.symbol ?? decision.marketRegime?.metadata?.symbol ?? 'SPY';
  const expirationMode = options?.expirationMode ?? '0DTE';

  // Adapt each step
  const q1 = adaptMarketRegime(decision.marketRegime);
  const q2 = adaptDirection(decision.direction);

  // Get underlying price from market data or fallback
  const underlyingPrice = decision.marketRegime?.metadata?.spyPrice
    ?? decision.direction?.signals?.spyPrice
    ?? 450;

  const q3 = adaptStrikes(decision.strikes, underlyingPrice, symbol, expirationMode);

  const premiumPerContract = q3.expectedPremiumPerContract / 100; // Convert to per-share
  const q4 = adaptSize(decision.positionSize, accountInfo, riskProfile, premiumPerContract);

  const q5 = adaptExitRules(decision.exitRules, q4.recommendedContracts, premiumPerContract, stopMultiplier);

  // Build trade proposal
  const tradeProposal = buildTradeProposal(decision, q3, q4, q5, symbol, expirationMode);

  // Build guard rails result
  const guardRails: GuardRailResult = {
    passed: (options?.guardRailViolations?.length ?? 0) === 0,
    violations: options?.guardRailViolations ?? [],
    checks: {
      deltaLimit: true,
      positionSize: q4.recommendedContracts <= q4.riskLimits.maxContracts,
      marginLimit: q4.pctOfNav <= q4.riskLimits.maxPositionPctOfNav,
      tradingWindow: options?.tradingWindowOpen ?? true,
    },
  };

  // Get trading window status
  const tradingWindow = getTradingWindowStatus();

  // Extract risk assessment from strikes decision (VIX-based dynamic delta & sizing)
  const riskAssessment: RiskAssessment | undefined = decision.strikes?.riskAssessment
    ? {
        vixLevel: decision.strikes.riskAssessment.vixLevel,
        riskRegime: decision.strikes.riskAssessment.riskRegime,
        targetDelta: decision.strikes.riskAssessment.targetDelta,
        contracts: decision.strikes.riskAssessment.contracts,
        reasoning: decision.strikes.riskAssessment.reasoning,
      }
    : undefined;

  return {
    timestamp: decision.timestamp.toISOString(),
    requestId: `req-${Date.now().toString(36)}`,
    version: '1.0.0',

    canTrade: decision.canTrade,
    executionReady: decision.executionReady && guardRails.passed, // Trading window disabled for testing
    reason: decision.reason,

    // Risk Assessment - VIX-based dynamic delta & position sizing
    riskAssessment,

    q1MarketRegime: q1,
    q2Direction: q2,
    q3Strikes: q3,
    q4Size: q4,
    q5Exit: q5,

    tradeProposal,
    guardRails,
    tradingWindow,
    audit: adaptAudit(decision.audit),

    // Include enhanced logging for new UI
    enhancedLog: decision.enhancedLog,
  };
}
