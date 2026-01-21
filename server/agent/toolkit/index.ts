/**
 * Toolkit - LLM-callable functions that wrap Engine steps
 *
 * Each function calls the corresponding Engine step and returns
 * a simplified result for the LLM to reason about.
 */

import { analyzeMarketRegime } from '../../engine/step1';
import { selectDirection } from '../../engine/step2';
import { selectStrikes } from '../../engine/step3';
import { calculatePositionSize } from '../../engine/step4';
import { defineExitRules } from '../../engine/step5';
import { getBroker } from '../../broker';
import type {
  MarketCheckResult,
  DirectionResult,
  StrikeResult,
  SizeResult,
  ExitRulesResult,
  ExecuteResult,
  PositionResult,
  StrikeInfo,
} from './types';

// Store state between tool calls within a single orchestration run
let cachedMarketRegime: Awaited<ReturnType<typeof analyzeMarketRegime>> | null = null;
let cachedDirection: Awaited<ReturnType<typeof selectDirection>> | null = null;
let cachedStrikes: Awaited<ReturnType<typeof selectStrikes>> | null = null;

/**
 * Reset cached state (call at start of each orchestration run)
 */
export function resetToolkitState(): void {
  cachedMarketRegime = null;
  cachedDirection = null;
  cachedStrikes = null;
}

/**
 * check_market - Check current market conditions
 */
export async function check_market(): Promise<MarketCheckResult> {
  const regime = await analyzeMarketRegime(true, 'SPY');
  cachedMarketRegime = regime;

  return {
    vix: regime.metadata?.vix ?? 0,
    vixChange: regime.metadata?.vixChange ?? 0,
    spyPrice: regime.metadata?.spyPrice ?? 0,
    spyChange: regime.metadata?.spyChange ?? 0,
    time: regime.metadata?.currentTime ?? new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' }),
    isMarketOpen: regime.withinTradingWindow,
    isTradingWindow: regime.withinTradingWindow,
    volatilityRegime: regime.metadata?.volatilityRegime ?? 'NORMAL',
  };
}

/**
 * analyze_direction - Analyze trend and get direction recommendation
 */
export async function analyze_direction(params: { symbol: string }): Promise<DirectionResult> {
  // Need market regime first
  if (!cachedMarketRegime) {
    cachedMarketRegime = await analyzeMarketRegime(true, params.symbol);
  }

  const direction = await selectDirection(cachedMarketRegime, params.symbol, '0DTE');
  cachedDirection = direction;

  return {
    direction: direction.direction,
    confidence: direction.confidence,
    trend: direction.signals?.trend ?? 'SIDEWAYS',
    reasoning: direction.reasoning,
    signals: {
      ma50: direction.signals?.ma ?? 0,
      spyPrice: direction.signals?.symbolPrice ?? 0,
      momentum: direction.signals?.momentum ?? 0,
    },
  };
}

/**
 * get_strikes - Get strikes at specified delta
 *
 * This is where LLM can override the Engine's default delta recommendation
 */
export async function get_strikes(params: { direction: 'PUT' | 'CALL'; targetDelta: number }): Promise<StrikeResult> {
  // Need market regime first
  if (!cachedMarketRegime) {
    cachedMarketRegime = await analyzeMarketRegime(true, 'SPY');
  }

  const spyPrice = cachedMarketRegime.metadata?.spyPrice ?? 0;

  // Get account info for margin calculation
  const broker = getBroker();
  let cashForMargin = 100000; // Default
  if (broker.api) {
    try {
      const account = await broker.api.getAccount();
      cashForMargin = account.netLiquidation ?? account.cashBalance ?? 100000;
    } catch {
      // Use default
    }
  }

  // Call step3 with the LLM's target delta
  const strikes = await selectStrikes(params.direction, spyPrice, 'SPY', '0DTE', cashForMargin);
  cachedStrikes = strikes;

  // Find the strike closest to target delta
  const targetStrike = params.direction === 'PUT' ? strikes.putStrike : strikes.callStrike;
  const alternatives = params.direction === 'PUT'
    ? strikes.nearbyStrikes?.puts ?? []
    : strikes.nearbyStrikes?.calls ?? [];

  const recommended: StrikeInfo | null = targetStrike ? {
    strike: targetStrike.strike,
    delta: Math.abs(targetStrike.delta),
    bid: targetStrike.bid,
    ask: targetStrike.ask,
    premium: (targetStrike.bid + targetStrike.ask) / 2,
    expiration: targetStrike.expiration.toISOString().split('T')[0],
  } : null;

  const alternativeInfos: StrikeInfo[] = alternatives.slice(0, 5).map(s => ({
    strike: s.strike,
    delta: Math.abs(s.delta),
    bid: s.bid,
    ask: s.ask,
    premium: (s.bid + s.ask) / 2,
    expiration: new Date().toISOString().split('T')[0],
  }));

  return {
    recommended,
    alternatives: alternativeInfos,
    targetDelta: params.targetDelta,
    actualDelta: recommended?.delta ?? 0,
    reasoning: strikes.reasoning,
  };
}

/**
 * calculate_size - Calculate position size based on risk
 */
export async function calculate_size(params: {
  strike: number;
  premium: number;
  riskProfile: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
}): Promise<SizeResult> {
  // Need strikes data
  if (!cachedStrikes) {
    throw new Error('Must call get_strikes before calculate_size');
  }

  // Get account info
  const broker = getBroker();
  let accountInfo = {
    cashBalance: 100000,
    buyingPower: 400000,
    netLiquidation: 100000,
    currentPositions: 0,
  };

  if (broker.api) {
    try {
      const account = await broker.api.getAccount();
      accountInfo = {
        cashBalance: account.cashBalance ?? 100000,
        buyingPower: account.buyingPower ?? 400000,
        netLiquidation: account.netLiquidation ?? 100000,
        currentPositions: 0,
      };
    } catch {
      // Use default
    }
  }

  const size = await calculatePositionSize(cachedStrikes, accountInfo, params.riskProfile);

  return {
    contracts: size.contracts,
    marginPerContract: size.marginPerContract,
    totalMargin: size.totalMarginRequired,
    maxLoss: size.maxLossTotal,
    maxLossPercent: (size.maxLossTotal / accountInfo.netLiquidation) * 100,
    riskProfile: params.riskProfile,
    reasoning: size.reasoning,
  };
}

/**
 * get_exit_rules - Get exit rules for position
 */
export async function get_exit_rules(params: {
  strike: number;
  contracts: number;
  entryPremium: number;
}): Promise<ExitRulesResult> {
  // Need strikes data
  if (!cachedStrikes) {
    throw new Error('Must call get_strikes before get_exit_rules');
  }

  const positionSize = {
    contracts: params.contracts,
    marginPerContract: 0,
    totalMarginRequired: 0,
    buyingPowerUsed: 0,
    buyingPowerRemaining: 0,
    maxLossPerContract: 0,
    maxLossTotal: 0,
    maxLossAllowed: 0,
    reasoning: '',
  };

  const exitRules = await defineExitRules(cachedStrikes, positionSize);

  return {
    stopLossPrice: exitRules.stopLossPrice,
    stopLossAmount: exitRules.stopLossAmount,
    stopLossMultiplier: exitRules.layer2?.multiplier ?? 6,
    timeStop: '15:55 ET', // Fixed time stop for 0DTE
    profitTarget: exitRules.takeProfitPrice,
    reasoning: exitRules.reasoning,
  };
}

/**
 * execute_trade - Execute the trade via IBKR
 *
 * NOTE: Currently logs only, actual execution TBD
 */
export async function execute_trade(params: {
  direction: 'PUT' | 'CALL';
  strike: number;
  contracts: number;
  limitPrice?: number;
}): Promise<ExecuteResult> {
  const broker = getBroker();

  if (!broker.api || !broker.status.connected) {
    return {
      success: false,
      status: 'ERROR',
      message: 'Broker not connected',
    };
  }

  // TODO: Implement actual order placement
  // For now, return a mock success for paper testing
  console.log(`[Toolkit] execute_trade: SELL ${params.contracts}x SPY ${params.strike}${params.direction[0]}`);

  return {
    success: true,
    orderId: `MOCK-${Date.now()}`,
    fillPrice: params.limitPrice ?? 0,
    status: 'PENDING',
    message: `Order submitted: SELL ${params.contracts}x SPY ${params.strike}${params.direction[0]}`,
  };
}

/**
 * check_position - Check current position status
 */
export async function check_position(): Promise<PositionResult> {
  const broker = getBroker();

  if (!broker.api || !broker.status.connected) {
    return { hasPosition: false };
  }

  try {
    const positions = await broker.api.getPositions();
    const spyPositions = positions.filter(p =>
      p.symbol === 'SPY' && p.status === 'open'
    );

    if (spyPositions.length === 0) {
      return { hasPosition: false };
    }

    const pos = spyPositions[0];
    const openCredit = parseFloat(pos.openCredit ?? '0');
    const currentValue = parseFloat(pos.currentValue ?? '0');
    const pnl = openCredit - currentValue;

    return {
      hasPosition: true,
      position: {
        direction: pos.strategy === 'put_credit' ? 'PUT' : 'CALL',
        strike: parseFloat(pos.sellStrike ?? '0'),
        contracts: pos.quantity ?? 0,
        entryPrice: openCredit / (pos.quantity ?? 1) / 100,
        currentPrice: currentValue / (pos.quantity ?? 1) / 100,
        pnl,
        pnlPercent: openCredit > 0 ? (pnl / openCredit) * 100 : 0,
        stopDistance: 0, // Calculate based on stop loss
      },
    };
  } catch {
    return { hasPosition: false };
  }
}

// Export all tools as a map for dynamic calling
export const toolkit = {
  check_market,
  analyze_direction,
  get_strikes,
  calculate_size,
  get_exit_rules,
  execute_trade,
  check_position,
};

export type ToolkitFunction = typeof toolkit[keyof typeof toolkit];
