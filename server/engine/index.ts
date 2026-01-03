// @ts-nocheck
// TODO: Fix duplicate property errors
/**
 * APEYOLO Trading Engine Orchestrator
 * Coordinates the 5-step decision process for automated options trading
 *
 * Steps:
 * 1. Market Regime Check - Should we trade today?
 * 2. Direction Selection - PUT, CALL, or STRANGLE?
 * 3. Strike Selection - What strikes based on delta?
 * 4. Position Sizing - How many contracts?
 * 5. Exit Rules - When to exit?
 */

import { analyzeMarketRegime, MarketRegime } from './step1.ts';
import { selectDirection, DirectionDecision, ExpirationMode as Step2ExpirationMode } from './step2.ts';
import { selectStrikes, StrikeSelection, ExpirationMode as Step3ExpirationMode } from './step3.ts';
import { calculatePositionSize, PositionSize, RiskProfile, AccountInfo } from './step4.ts';
import { defineExitRules, ExitRules } from './step5.ts';
import type { OptionChainDiagnostics } from '../../shared/types/engine';
import type { EnhancedEngineLog, EnhancedStepLog, StepReasoning, StepMetric } from '../../shared/types/engineLog';
import { db } from '../db';
import { engineRuns } from '@shared/schema';
import { getIndicatorSnapshotSafe } from '../services/indicators/ibkrFetcher';

/**
 * Custom error class for engine failures with step context
 * Includes partial enhancedLog for UI display even on failure
 */
export class EngineError extends Error {
  public diagnostics?: OptionChainDiagnostics;
  public enhancedLog?: EnhancedEngineLog;

  constructor(
    public step: number,
    public stepName: string,
    public reason: string,
    public audit: AuditEntry[],
    diagnostics?: OptionChainDiagnostics,
    enhancedLog?: EnhancedEngineLog
  ) {
    super(`[Step ${step}] ${stepName} failed: ${reason}`);
    this.name = 'EngineError';
    this.diagnostics = diagnostics;
    this.enhancedLog = enhancedLog;
  }
}

/**
 * Complete trading decision combining all 5 steps
 */
export interface TradingDecision {
  timestamp: Date;
  canTrade: boolean;
  withinTradingWindow: boolean;  // Whether we're in trading hours
  analysisComplete: boolean;     // Whether all 5 steps completed
  reason?: string;
  marketRegime?: MarketRegime;
  direction?: DirectionDecision;
  strikes?: StrikeSelection;
  positionSize?: PositionSize;
  exitRules?: ExitRules;
  executionReady: boolean;
  audit: AuditEntry[];
  // Enhanced logging for UI
  enhancedLog?: EnhancedEngineLog;
  engineRunId?: string;  // ID for tracking adjustments
}

/**
 * Audit entry for tracking decision process
 */
export interface AuditEntry {
  step: number;
  name: string;
  timestamp: Date;
  input: any;
  output: any;
  passed: boolean;
  reason?: string;
}

/**
 * Expiration mode for options
 */
export type ExpirationMode = '0DTE' | 'WEEKLY';

/**
 * Strategy preference for single-leg trades
 */
export type StrategyPreference = 'strangle' | 'put-only' | 'call-only';

/**
 * Engine configuration
 */
export interface EngineConfig {
  riskProfile: RiskProfile;
  underlyingSymbol: string;
  expirationMode?: ExpirationMode; // '0DTE' for same-day, 'WEEKLY' for Friday expiry
  underlyingPrice?: number; // If not provided, will fetch from market
  mockMode?: boolean;       // Use mock data for testing
  forcedStrategy?: StrategyPreference; // Force PUT-only or CALL-only instead of auto
}

/**
 * Main Trading Engine class
 */
export class TradingEngine {
  private config: EngineConfig;
  private audit: AuditEntry[] = [];

  constructor(config: EngineConfig) {
    this.config = {
      riskProfile: 'BALANCED',
      underlyingSymbol: 'SPY',
      mockMode: true, // Default to mock mode until IBKR integration
      ...config
    };
  }

  /**
   * Add entry to audit trail
   */
  private addAudit(step: number, name: string, input: any, output: any, passed: boolean, reason?: string) {
    this.audit.push({
      step,
      name,
      timestamp: new Date(),
      input,
      output,
      passed,
      reason
    });
  }

  /**
   * Build partial enhancedLog for error responses
   * Includes completed steps + the failed step
   */
  private buildPartialEnhancedLog(
    completedSteps: EnhancedStepLog[],
    failedStep: { step: number; name: string; error: string; durationMs: number },
    totalDurationMs: number
  ): EnhancedEngineLog {
    const durations = [...completedSteps.map(s => s.durationMs), failedStep.durationMs];
    const maxDuration = Math.max(...durations);

    // Mark slowest step
    const stepsWithSlowest = completedSteps.map(s => ({
      ...s,
      isSlowest: s.durationMs === maxDuration
    }));

    // Add failed step
    const failedStepLog: EnhancedStepLog = {
      step: failedStep.step,
      name: failedStep.name,
      status: 'failed' as const,
      durationMs: failedStep.durationMs,
      isSlowest: failedStep.durationMs === maxDuration,
      reasoning: [{ question: 'Error', answer: failedStep.error }],
      metrics: [],
      error: {
        message: failedStep.error,
        suggestion: this.getErrorSuggestion(failedStep.step, failedStep.error)
      }
    };

    // Add remaining steps as skipped
    const stepNames = ['Market Regime Check', 'Direction Selection', 'Strike Selection', 'Position Sizing', 'Exit Rules'];
    const skippedSteps: EnhancedStepLog[] = [];
    for (let i = failedStep.step; i < 5; i++) {
      skippedSteps.push({
        step: i + 1,
        name: stepNames[i],
        status: 'skipped' as const,
        durationMs: 0,
        isSlowest: false,
        reasoning: [{ question: 'Status', answer: 'Skipped due to previous step failure' }],
        metrics: []
      });
    }

    return {
      totalDurationMs,
      steps: [...stepsWithSlowest, failedStepLog, ...skippedSteps],
      summary: {
        strategy: 'ANALYSIS INCOMPLETE',
        strike: 'N/A',
        contracts: 0,
        premium: 0,
        stopLoss: 'N/A',
        status: `FAILED AT STEP ${failedStep.step}`,
        reason: failedStep.error
      }
    };
  }

  /**
   * Get helpful suggestion based on error type
   */
  private getErrorSuggestion(step: number, error: string): string {
    if (error.includes('Option chain unavailable') || error.includes('puts=0, calls=0')) {
      return 'Market is closed or option chain data is not available. Try again during regular trading hours (9:30 AM - 4:00 PM ET).';
    }
    if (error.includes('No SPY price')) {
      return 'Unable to fetch SPY price from IBKR. Check broker connection.';
    }
    if (error.includes('VIX')) {
      return 'VIX data unavailable. Check market data subscription.';
    }
    if (error.includes('margin') || error.includes('buying power')) {
      return 'Insufficient funds for this position. Consider reducing position size.';
    }
    return `Step ${step} encountered an error. Check logs for details.`;
  }

  /**
   * Execute the complete 5-step trading decision process
   * @param accountInfo - Current account information
   * @returns Complete trading decision with audit trail
   */
  async executeTradingDecision(accountInfo: AccountInfo): Promise<TradingDecision> {
    console.log('\n' + '='.repeat(60));
    console.log('[Engine] APEYOLO TRADING ENGINE - DECISION PROCESS');
    console.log('[Engine] Started at:', new Date().toISOString());
    console.log('='.repeat(60));

    // Reset audit trail
    this.audit = [];

    // Track step timings for enhanced log
    const engineStartTime = Date.now();
    const completedSteps: EnhancedStepLog[] = [];
    let stepStartTime = Date.now();

    // Step 1: Market Regime Check
    let marketRegime: MarketRegime;
    stepStartTime = Date.now();
    const symbol = this.config.underlyingSymbol;
    const expirationMode: Step3ExpirationMode = this.config.expirationMode || '0DTE';
    console.log(`\n[Engine] Step 1 START: Market Regime Check (${symbol}, ${expirationMode})`);
    try {
      marketRegime = await analyzeMarketRegime(true, symbol);
      console.log(`[Engine] Step 1 COMPLETE (${Date.now() - stepStartTime}ms)`);
      console.log(`[Engine] Step 1 Result: VIX=${marketRegime.metadata?.vix?.toFixed(2) || 'N/A'}, ${symbol}=$${marketRegime.metadata?.spyPrice?.toFixed(2) || 'N/A'}`);
    } catch (error: any) {
      const stepDuration = Date.now() - stepStartTime;
      console.error(`[Engine] Step 1 FAILED (${stepDuration}ms): ${error.message}`);
      this.addAudit(1, 'Market Regime Check', {}, { error: error.message }, false, error.message);
      const partialLog = this.buildPartialEnhancedLog(
        completedSteps,
        { step: 1, name: 'Market Regime Check', error: error.message, durationMs: stepDuration },
        Date.now() - engineStartTime
      );
      throw new EngineError(1, 'Market Regime Check', error.message, this.audit, undefined, partialLog);
    }

    const withinTradingWindow = marketRegime.withinTradingWindow;
    const canExecute = marketRegime.canExecute;

    // Determine step 1 result for audit (pass if VIX is acceptable, regardless of trading window)
    const step1Passed = marketRegime.shouldTrade;
    this.addAudit(1, 'Market Regime Check', {}, marketRegime, step1Passed, marketRegime.reason);

    // Add Step 1 to completed steps for enhanced log
    const step1Duration = Date.now() - stepStartTime;
    completedSteps.push({
      step: 1,
      name: 'Market Regime Check',
      status: step1Passed ? 'passed' : 'failed',
      durationMs: step1Duration,
      isSlowest: false, // Will be recalculated at the end
      reasoning: marketRegime.reasoning || [
        { question: 'VIX acceptable?', answer: marketRegime.shouldTrade ? `YES (${marketRegime.metadata?.vix?.toFixed(2) || 'N/A'})` : `NO (${marketRegime.metadata?.vix?.toFixed(2) || 'N/A'})` },
        { question: 'Trading window?', answer: withinTradingWindow ? 'OPEN' : 'CLOSED' }
      ],
      metrics: marketRegime.metrics || [
        { label: 'VIX', value: marketRegime.metadata?.vix?.toFixed(2) || 'N/A', status: 'normal' as const },
        { label: 'SPY', value: marketRegime.metadata?.spyPrice ? `$${marketRegime.metadata.spyPrice.toFixed(2)}` : 'N/A', status: 'normal' as const }
      ]
    });

    if (canExecute) {
      console.log(`  Result: ✅ CAN TRADE`);
    } else if (marketRegime.shouldTrade && !withinTradingWindow) {
      console.log(`  Result: ⚠️ ANALYSIS MODE (outside trading window)`);
    } else {
      console.log(`  Result: ❌ NO TRADE (VIX too high)`);
    }
    console.log(`  Reason: ${marketRegime.reason}`);

    // ALWAYS continue to Steps 2-5 for analysis (no early exit!)
    // Only EXTREME VIX (shouldTrade=false) should stop, but we still show the data

    // Step 2: Direction Selection
    let direction: DirectionDecision;
    stepStartTime = Date.now();
    const forcedStrategy = this.config.forcedStrategy;
    const strategyLabel = forcedStrategy === 'put-only' ? 'PUT-only' : forcedStrategy === 'call-only' ? 'CALL-only' : 'Auto';
    console.log(`\n[Engine] Step 2 START: Direction Selection (${strategyLabel})`);
    try {
      // Pass symbol, expirationMode, and forcedStrategy for timeframe-adapted analysis
      direction = await selectDirection(marketRegime, symbol, expirationMode as Step2ExpirationMode, undefined, forcedStrategy);
      console.log(`[Engine] Step 2 COMPLETE (${Date.now() - stepStartTime}ms)`);
    } catch (error: any) {
      const stepDuration = Date.now() - stepStartTime;
      console.error(`[Engine] Step 2 FAILED (${stepDuration}ms): ${error.message}`);
      this.addAudit(2, 'Direction Selection', { marketRegime }, { error: error.message }, false, error.message);
      const partialLog = this.buildPartialEnhancedLog(
        completedSteps,
        { step: 2, name: 'Direction Selection', error: error.message, durationMs: stepDuration },
        Date.now() - engineStartTime
      );
      throw new EngineError(2, 'Direction Selection', error.message, this.audit, undefined, partialLog);
    }
    this.addAudit(2, 'Direction Selection', { marketRegime }, direction, true, direction.reasoning);

    // Add Step 2 to completed steps
    const step2Duration = Date.now() - stepStartTime;
    completedSteps.push({
      step: 2,
      name: 'Direction Selection',
      status: 'passed',
      durationMs: step2Duration,
      isSlowest: false,
      reasoning: direction.stepReasoning || [
        { question: 'Trend?', answer: direction.signals?.trend || 'SIDEWAYS' },
        { question: 'Strategy?', answer: `SELL ${direction.direction}` }
      ],
      metrics: direction.stepMetrics || [
        { label: 'Direction', value: direction.direction, status: 'normal' as const },
        { label: 'Confidence', value: `${(direction.confidence * 100).toFixed(0)}%`, status: 'normal' as const }
      ]
    });

    console.log(`  Direction: ${direction.direction}`);
    console.log(`  Confidence: ${(direction.confidence * 100).toFixed(0)}%`);
    console.log(`  Reasoning: ${direction.reasoning}`);

    // Step 3: Strike Selection
    let strikes: StrikeSelection;
    stepStartTime = Date.now();
    console.log(`\n[Engine] Step 3 START: Strike Selection (${symbol}, ${expirationMode})`);

    // Use REAL underlying price from Step 1 (IBKR only - no fallbacks)
    const underlyingPrice = marketRegime.metadata?.spyPrice || 0;
    console.log(`[Engine] Step 3: ${symbol} price from Step 1 = $${underlyingPrice}`);

    if (!underlyingPrice || underlyingPrice <= 0) {
      const stepDuration = Date.now() - stepStartTime;
      const errorMsg = `[IBKR] No ${symbol} price available from Step 1 - cannot proceed without real IBKR data`;
      console.error(`[Engine] Step 3 FAILED: ${errorMsg}`);
      this.addAudit(3, 'Strike Selection', { underlyingPrice }, { error: errorMsg }, false, errorMsg);
      const partialLog = this.buildPartialEnhancedLog(
        completedSteps,
        { step: 3, name: 'Strike Selection', error: errorMsg, durationMs: stepDuration },
        Date.now() - engineStartTime
      );
      throw new EngineError(3, 'Strike Selection', errorMsg, this.audit, undefined, partialLog);
    }

    try {
      // Pass cash (netLiquidation) for margin-based contract sizing
      // Margin is calculated from cash, not buying power
      const cashForMargin = accountInfo.netLiquidation ?? accountInfo.cashBalance;
      strikes = await selectStrikes(direction.direction, underlyingPrice, symbol, expirationMode, cashForMargin);
      console.log(`[Engine] Step 3 COMPLETE (${Date.now() - stepStartTime}ms)`);
    } catch (error: any) {
      const stepDuration = Date.now() - stepStartTime;
      console.error(`[Engine] Step 3 FAILED (${stepDuration}ms): ${error.message}`);
      // Extract diagnostics if present (from option chain errors)
      const diagnostics = error.diagnostics as OptionChainDiagnostics | undefined;
      if (diagnostics) {
        console.log(`[Engine] Step 3 Diagnostics: conid=${diagnostics.conid}, month=${diagnostics.monthFormatted}, underlyingPrice=${diagnostics.underlyingPrice}`);
      }
      this.addAudit(3, 'Strike Selection', { direction: direction.direction, underlyingPrice }, { error: error.message, diagnostics }, false, error.message);
      const partialLog = this.buildPartialEnhancedLog(
        completedSteps,
        { step: 3, name: 'Strike Selection', error: error.message, durationMs: stepDuration },
        Date.now() - engineStartTime
      );
      throw new EngineError(3, 'Strike Selection', error.message, this.audit, diagnostics, partialLog);
    }
    this.addAudit(3, 'Strike Selection', { direction: direction.direction, underlyingPrice }, strikes, true, strikes.reasoning);

    // Add Step 3 to completed steps
    const step3Duration = Date.now() - stepStartTime;
    completedSteps.push({
      step: 3,
      name: 'Strike Selection',
      status: 'passed',
      durationMs: step3Duration,
      isSlowest: false,
      reasoning: strikes.stepReasoning || [
        { question: 'Strike?', answer: strikes.putStrike ? `$${strikes.putStrike.strike} PUT` : strikes.callStrike ? `$${strikes.callStrike.strike} CALL` : 'N/A' }
      ],
      metrics: strikes.stepMetrics || [
        { label: 'Premium', value: `$${strikes.expectedPremium.toFixed(2)}`, status: 'normal' as const }
      ],
      nearbyStrikes: strikes.enhancedNearbyStrikes
    });

    if (strikes.putStrike) {
      console.log(`  PUT Strike: $${strikes.putStrike.strike} (delta: ${strikes.putStrike.delta})`);
    }
    if (strikes.callStrike) {
      console.log(`  CALL Strike: $${strikes.callStrike.strike} (delta: ${strikes.callStrike.delta})`);
    }
    console.log(`  Expected Premium: $${strikes.expectedPremium}`);

    // Step 4: Position Sizing
    let positionSize: PositionSize;
    stepStartTime = Date.now();
    console.log('\n[Engine] Step 4 START: Position Sizing');
    try {
      positionSize = await calculatePositionSize(strikes, accountInfo, this.config.riskProfile);
      console.log(`[Engine] Step 4 COMPLETE (${Date.now() - stepStartTime}ms)`);
    } catch (error: any) {
      const stepDuration = Date.now() - stepStartTime;
      console.error(`[Engine] Step 4 FAILED (${stepDuration}ms): ${error.message}`);
      this.addAudit(4, 'Position Sizing', { strikes, accountInfo, riskProfile: this.config.riskProfile }, { error: error.message }, false, error.message);
      const partialLog = this.buildPartialEnhancedLog(
        completedSteps,
        { step: 4, name: 'Position Sizing', error: error.message, durationMs: stepDuration },
        Date.now() - engineStartTime
      );
      throw new EngineError(4, 'Position Sizing', error.message, this.audit, undefined, partialLog);
    }
    this.addAudit(4, 'Position Sizing', { strikes, accountInfo, riskProfile: this.config.riskProfile }, positionSize, positionSize.contracts > 0, positionSize.reasoning);

    // Add Step 4 to completed steps
    const step4Duration = Date.now() - stepStartTime;
    completedSteps.push({
      step: 4,
      name: 'Position Sizing',
      status: positionSize.contracts > 0 ? 'passed' : 'failed',
      durationMs: step4Duration,
      isSlowest: false,
      reasoning: positionSize.stepReasoning || [
        { question: 'Contracts?', answer: `${positionSize.contracts}` }
      ],
      metrics: positionSize.stepMetrics || [
        { label: 'Contracts', value: positionSize.contracts, status: positionSize.contracts > 0 ? 'normal' as const : 'critical' as const },
        { label: 'Margin', value: `$${positionSize.totalMarginRequired.toFixed(0)}`, status: 'normal' as const }
      ]
    });

    console.log(`  Risk Profile: ${this.config.riskProfile}`);
    console.log(`  Contracts: ${positionSize.contracts}`);
    console.log(`  Margin Required: $${positionSize.totalMarginRequired.toLocaleString()}`);
    console.log(`  Buying Power Remaining: $${positionSize.buyingPowerRemaining.toLocaleString()}`);

    // Check if we can actually trade (but don't return early - continue to Step 5)
    const hasSufficientFunds = positionSize.contracts > 0;
    if (!hasSufficientFunds) {
      console.log('  ⚠️ Insufficient buying power - analysis will continue');
    }

    // Step 5: Exit Rules
    let exitRules: ExitRules;
    stepStartTime = Date.now();
    console.log('\n[Engine] Step 5 START: Exit Rules');
    try {
      exitRules = await defineExitRules(strikes, positionSize);
      console.log(`[Engine] Step 5 COMPLETE (${Date.now() - stepStartTime}ms)`);
    } catch (error: any) {
      const stepDuration = Date.now() - stepStartTime;
      console.error(`[Engine] Step 5 FAILED (${stepDuration}ms): ${error.message}`);
      this.addAudit(5, 'Exit Rules', { strikes, positionSize }, { error: error.message }, false, error.message);
      const partialLog = this.buildPartialEnhancedLog(
        completedSteps,
        { step: 5, name: 'Exit Rules', error: error.message, durationMs: stepDuration },
        Date.now() - engineStartTime
      );
      throw new EngineError(5, 'Exit Rules', error.message, this.audit, undefined, partialLog);
    }
    this.addAudit(5, 'Exit Rules', { strikes, positionSize }, exitRules, true, exitRules.reasoning);

    // Add Step 5 to completed steps
    const step5Duration = Date.now() - stepStartTime;
    completedSteps.push({
      step: 5,
      name: 'Exit Rules',
      status: 'passed',
      durationMs: step5Duration,
      isSlowest: false,
      reasoning: exitRules.stepReasoning || [
        { question: 'Stop loss?', answer: `$${exitRules.stopLossPrice}` }
      ],
      metrics: exitRules.stepMetrics || [
        { label: 'Stop Loss', value: `$${exitRules.stopLossAmount.toFixed(2)}`, status: 'normal' as const }
      ]
    });

    console.log(`  Stop Loss: $${exitRules.stopLossPrice} per share ($${exitRules.stopLossAmount} total)`);
    console.log(`  Take Profit: ${exitRules.takeProfitPrice || 'None (let expire)'}`);
    console.log(`  Max Hold Time: ${exitRules.maxHoldingTime} hours`);

    // Final decision - need all conditions: VIX OK, trading window, sufficient funds
    const fullyReady = canExecute && hasSufficientFunds;

    console.log('\n' + '='.repeat(60));
    if (fullyReady) {
      console.log('✅ TRADING DECISION COMPLETE - READY TO EXECUTE');
    } else if (!hasSufficientFunds) {
      console.log('⚠️ ANALYSIS COMPLETE - INSUFFICIENT FUNDS');
    } else if (marketRegime.shouldTrade && !withinTradingWindow) {
      console.log('⚠️ ANALYSIS COMPLETE - WAITING FOR TRADING WINDOW');
    } else {
      console.log('❌ ANALYSIS COMPLETE - MARKET CONDITIONS UNFAVORABLE');
    }
    console.log('='.repeat(60));

    // Build final reason
    let finalReason = marketRegime.reason;
    if (!hasSufficientFunds) {
      finalReason = 'Insufficient buying power for position';
    }

    // Build enhanced log for UI using incrementally collected steps
    const totalDurationMs = Date.now() - engineStartTime;
    const durations = completedSteps.map(s => s.durationMs);
    const maxDuration = Math.max(...durations);

    // Mark slowest step
    const enhancedSteps = completedSteps.map(step => ({
      ...step,
      isSlowest: step.durationMs === maxDuration
    }));

    // Build summary for UI
    const selectedStrike = strikes.putStrike || strikes.callStrike;
    const expirationLabel = expirationMode === '0DTE' ? '0DTE' : 'Weekly';
    const strikeLabel = selectedStrike
      ? `${symbol} $${selectedStrike.strike}${strikes.putStrike ? 'P' : 'C'} ${expirationLabel}`
      : 'N/A';

    const enhancedLog: EnhancedEngineLog = {
      totalDurationMs,
      steps: enhancedSteps,
      summary: {
        strategy: `SELL ${direction.direction}`,
        strike: strikeLabel,
        contracts: positionSize.contracts,
        premium: strikes.expectedPremium,
        stopLoss: `$${exitRules.stopLossPrice} ($${exitRules.stopLossAmount} max)`,
        status: fullyReady ? 'READY' : !hasSufficientFunds ? 'INSUFFICIENT FUNDS' : !withinTradingWindow ? 'OUTSIDE WINDOW' : 'NOT READY',
        reason: fullyReady ? undefined : finalReason
      }
    };

    // Log engine run for RLHF tracking
    let engineRunId: string | undefined;
    try {
      // Fetch current indicators for market context
      const indicators = await getIndicatorSnapshotSafe(symbol);

      const [engineRunRecord] = await db.insert(engineRuns).values({
        userId: undefined, // Will be set by the route handler if user context available
        symbol: symbol,
        direction: direction.direction,
        expirationMode: expirationMode,
        originalPutStrike: strikes.putStrike?.strike,
        originalCallStrike: strikes.callStrike?.strike,
        originalPutDelta: strikes.putStrike?.delta,
        originalCallDelta: strikes.callStrike?.delta,
        underlyingPrice: underlyingPrice,
        vix: marketRegime.metadata?.vix,
        indicators: indicators || undefined,
        engineOutput: {
          marketRegime: {
            shouldTrade: marketRegime.shouldTrade,
            reason: marketRegime.reason,
            volatilityRegime: marketRegime.metadata?.volatilityRegime,
          },
          direction: {
            direction: direction.direction,
            confidence: direction.confidence,
            signals: direction.signals,
          },
          positionSize: positionSize,
          exitRules: exitRules,
        },
      }).returning();

      engineRunId = engineRunRecord.id;
      console.log(`[Engine] Logged run to engine_runs: ${engineRunId}`);
    } catch (error) {
      console.error('[Engine] Failed to log engine run:', error);
      // Non-fatal - continue with decision even if logging fails
    }

    return {
      timestamp: new Date(),
      canTrade: fullyReady,
      withinTradingWindow,
      analysisComplete: true,
      reason: finalReason,
      marketRegime,
      direction,
      strikes,
      positionSize,
      exitRules,
      executionReady: fullyReady,
      audit: this.audit,
      enhancedLog,
      engineRunId,
    };
  }

  /**
   * Generate a summary of the trading decision
   * @param decision - Trading decision to summarize
   * @returns Human-readable summary
   */
  generateSummary(decision: TradingDecision): string {
    if (!decision.canTrade) {
      return `Cannot trade: ${decision.reason}`;
    }

    let summary = 'TRADE SUMMARY:\n';
    summary += `Strategy: Sell ${decision.direction?.direction}\n`;

    if (decision.strikes?.putStrike) {
      summary += `PUT: ${decision.strikes.putStrike.strike} strike\n`;
    }
    if (decision.strikes?.callStrike) {
      summary += `CALL: ${decision.strikes.callStrike.strike} strike\n`;
    }

    summary += `Contracts: ${decision.positionSize?.contracts}\n`;
    summary += `Expected Premium: $${decision.strikes?.expectedPremium}\n`;
    summary += `Margin Required: $${decision.positionSize?.totalMarginRequired}\n`;
    summary += `Stop Loss: $${decision.exitRules?.stopLossAmount}\n`;

    return summary;
  }

  /**
   * Export decision for logging/storage
   * @param decision - Trading decision to export
   * @returns JSON-serializable object
   */
  exportDecision(decision: TradingDecision): object {
    return {
      timestamp: decision.timestamp.toISOString(),
      canTrade: decision.canTrade,
      reason: decision.reason,
      summary: decision.canTrade ? {
        direction: decision.direction?.direction,
        putStrike: decision.strikes?.putStrike?.strike,
        callStrike: decision.strikes?.callStrike?.strike,
        contracts: decision.positionSize?.contracts,
        expectedPremium: decision.strikes?.expectedPremium,
        marginRequired: decision.positionSize?.totalMarginRequired,
        stopLoss: decision.exitRules?.stopLossAmount
      } : null,
      audit: decision.audit.map(entry => ({
        step: entry.step,
        name: entry.name,
        timestamp: entry.timestamp.toISOString(),
        passed: entry.passed,
        reason: entry.reason
      }))
    };
  }
}

/**
 * Test the complete engine flow
 */
export async function testEngine(): Promise<void> {
  console.log('Testing Complete Trading Engine\n');

  // Create engine with test configuration
  const engine = new TradingEngine({
    riskProfile: 'BALANCED',
    underlyingSymbol: 'SPY',
    underlyingPrice: 450,
    mockMode: true
  });

  // Mock account info
  const accountInfo: AccountInfo = {
    cashBalance: 100000,
    buyingPower: 666000,
    currentPositions: 0
  };

  console.log('Account Configuration:');
  console.log(`  Cash: $${accountInfo.cashBalance.toLocaleString()}`);
  console.log(`  Buying Power: $${accountInfo.buyingPower.toLocaleString()}`);
  console.log(`  Risk Profile: BALANCED`);

  // Execute trading decision
  const decision = await engine.executeTradingDecision(accountInfo);

  // Display summary
  console.log('\n' + '='.repeat(60));
  console.log('DECISION SUMMARY');
  console.log('='.repeat(60));
  console.log(engine.generateSummary(decision));

  // Export for storage
  console.log('\n' + '='.repeat(60));
  console.log('EXPORTED DECISION (for logging)');
  console.log('='.repeat(60));
  console.log(JSON.stringify(engine.exportDecision(decision), null, 2));
}

// Test function can be called from a separate test file