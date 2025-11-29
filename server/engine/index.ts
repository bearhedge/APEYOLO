/**
 * APEYOLO Trading Engine Orchestrator
 * Coordinates the 5-step decision process for automated options trading
 *
 * Enhanced with transparent reasoning chains across all 5 steps:
 * 1. Market Regime Check - Should we trade today? (VIX hard stop at 20)
 * 2. Direction Selection - PUT, CALL, or STRANGLE? (MA + RSI analysis)
 * 3. Strike Selection - What strikes based on delta? (IBKR real-time data)
 * 4. Position Sizing - How many contracts? (Risk profile + margin)
 * 5. Exit Rules - When to exit? (Stop loss + time-based)
 *
 * All steps produce transparent reasoning chains for audit and display.
 */

import { analyzeMarketRegime, MarketRegime } from './step1.ts';
import { selectDirection, DirectionDecision } from './step2.ts';
import { selectStrikes, StrikeSelection } from './step3.ts';
import { calculatePositionSize, PositionSize, RiskProfile, AccountInfo } from './step4.ts';
import { defineExitRules, ExitRules, STOP_LOSS_OPTIONS } from './step5.ts';
import {
  createAggregator,
  ReasoningAggregator,
  StepReasoning,
  ReasoningAuditEntry,
} from './reasoningLogger.ts';

/**
 * Complete trading decision combining all 5 steps
 */
export interface TradingDecision {
  timestamp: Date;
  canTrade: boolean;
  reason?: string;
  marketRegime?: MarketRegime;
  direction?: DirectionDecision;
  strikes?: StrikeSelection;
  positionSize?: PositionSize;
  exitRules?: ExitRules;
  executionReady: boolean;
  audit: AuditEntry[];
  // NEW: Full reasoning chains for transparency
  reasoningChain?: StepReasoning[];
  reasoningSummary?: {
    totalSteps: number;
    passedSteps: number;
    totalWarnings: number;
    totalComputations: number;
    averageConfidence: number;
    canExecute: boolean;
    failedAtStep?: number;
    elapsedMs: number;
  };
}

/**
 * Audit entry for tracking decision process
 * Enhanced with full reasoning chain
 */
export interface AuditEntry {
  step: number;
  name: string;
  timestamp: Date;
  input: any;
  output: any;
  passed: boolean;
  reason?: string;
  // NEW: Full reasoning chain for this step
  reasoning?: StepReasoning;
}

/**
 * Engine configuration
 */
export interface EngineConfig {
  riskProfile: RiskProfile;
  underlyingSymbol: string;
  underlyingPrice?: number;     // If not provided, will fetch from market
  stopLossMultiplier?: number;  // Default: 2.0 (200%)
  mockMode?: boolean;           // Use mock data for testing
}

/**
 * Main Trading Engine class
 * Enhanced with transparent reasoning chains
 */
export class TradingEngine {
  private config: EngineConfig;
  private audit: AuditEntry[] = [];
  private reasoningAggregator: ReasoningAggregator;

  constructor(config: EngineConfig) {
    this.config = {
      riskProfile: 'BALANCED',
      underlyingSymbol: 'SPY',
      stopLossMultiplier: 2.0,
      mockMode: false, // Use real IBKR data by default
      ...config
    };
    this.reasoningAggregator = createAggregator();
  }

  /**
   * Add entry to audit trail with reasoning chain
   */
  private addAudit(
    step: number,
    name: string,
    input: any,
    output: any,
    passed: boolean,
    reason?: string,
    reasoning?: StepReasoning
  ) {
    this.audit.push({
      step,
      name,
      timestamp: new Date(),
      input,
      output,
      passed,
      reason,
      reasoning,
    });

    // Also add to reasoning aggregator if provided
    if (reasoning) {
      this.reasoningAggregator.addStep(reasoning);
    }
  }

  /**
   * Execute the complete 5-step trading decision process
   * @param accountInfo - Current account information
   * @returns Complete trading decision with audit trail and full reasoning chains
   */
  async executeTradingDecision(accountInfo: AccountInfo): Promise<TradingDecision> {
    const startTime = Date.now();

    console.log('\n' + '='.repeat(60));
    console.log('APEYOLO TRADING ENGINE - DECISION PROCESS');
    console.log('='.repeat(60));

    // Reset audit trail and reasoning aggregator
    this.audit = [];
    this.reasoningAggregator = createAggregator();

    // Step 1: Market Regime Check
    console.log('\n📊 Step 1: Market Regime Check');
    const marketRegime = await analyzeMarketRegime();
    this.addAudit(
      1,
      'Market Regime Check',
      { tradingWindow: '11AM-1PM ET', vixHardStop: 20 },
      marketRegime,
      marketRegime.shouldTrade,
      marketRegime.reason,
      marketRegime.reasoning // StepReasoning from step1
    );
    console.log(`  Result: ${marketRegime.shouldTrade ? '✅ CAN TRADE' : '❌ NO TRADE'}`);
    console.log(`  Reason: ${marketRegime.reason}`);

    // Early exit if market conditions unfavorable
    if (!marketRegime.shouldTrade) {
      const elapsedMs = Date.now() - startTime;
      return {
        timestamp: new Date(),
        canTrade: false,
        reason: marketRegime.reason,
        marketRegime,
        executionReady: false,
        audit: this.audit,
        reasoningChain: this.reasoningAggregator.getSteps(),
        reasoningSummary: {
          ...this.reasoningAggregator.getSummary(),
          elapsedMs,
        },
      };
    }

    // Step 2: Direction Selection
    console.log('\n🎯 Step 2: Direction Selection');
    const direction = await selectDirection(marketRegime);
    this.addAudit(
      2,
      'Direction Selection',
      { marketRegime: marketRegime.regime, volatilityRegime: marketRegime.volatilityRegime },
      direction,
      true,
      direction.reasoning, // Short string reason
      direction.stepReasoning // Full StepReasoning chain
    );
    console.log(`  Direction: ${direction.direction}`);
    console.log(`  Bias: ${direction.bias}`);
    console.log(`  Confidence: ${(direction.confidence * 100).toFixed(0)}%`);
    console.log(`  Delta Target: ${direction.targetDelta.min}-${direction.targetDelta.max}`);
    console.log(`  Reasoning: ${direction.reasoning}`);

    // Step 3: Strike Selection
    // Pass full DirectionDecision so step3 uses the targetDelta from step2
    console.log('\n🎲 Step 3: Strike Selection');
    const strikes = await selectStrikes(
      direction, // Pass full DirectionDecision, not just direction.direction
      this.config.underlyingPrice, // Will be overridden by IBKR real-time price
      this.config.underlyingSymbol
    );
    this.addAudit(
      3,
      'Strike Selection',
      {
        direction: direction.direction,
        targetDelta: direction.targetDelta,
        symbol: this.config.underlyingSymbol,
      },
      strikes,
      true,
      strikes.reason, // Short string reason
      strikes.reasoning // Full StepReasoning chain
    );

    if (strikes.putStrike) {
      console.log(`  PUT Strike: $${strikes.putStrike.strike} (delta: ${strikes.putStrike.delta.toFixed(3)})`);
    }
    if (strikes.callStrike) {
      console.log(`  CALL Strike: $${strikes.callStrike.strike} (delta: ${strikes.callStrike.delta.toFixed(3)})`);
    }
    console.log(`  Expected Premium: $${strikes.expectedPremium.toFixed(2)}`);
    console.log(`  Margin Required: $${strikes.marginRequired.toLocaleString()}`);

    // Step 4: Position Sizing
    console.log('\n📏 Step 4: Position Sizing');
    const positionSize = await calculatePositionSize(strikes, accountInfo, this.config.riskProfile);
    this.addAudit(
      4,
      'Position Sizing',
      {
        expectedPremium: strikes.expectedPremium,
        marginRequired: strikes.marginRequired,
        buyingPower: accountInfo.buyingPower,
        riskProfile: this.config.riskProfile,
      },
      positionSize,
      positionSize.contracts > 0,
      positionSize.reason, // Short string reason
      positionSize.reasoning // Full StepReasoning chain
    );

    console.log(`  Risk Profile: ${this.config.riskProfile}`);
    console.log(`  Contracts: ${positionSize.contracts}`);
    console.log(`  Margin/Contract: $${positionSize.marginPerContract.toLocaleString()}`);
    console.log(`  Total Margin: $${positionSize.totalMarginRequired.toLocaleString()}`);
    console.log(`  Buying Power Remaining: $${positionSize.buyingPowerRemaining.toLocaleString()}`);

    // Check if we can actually trade
    if (positionSize.contracts === 0) {
      const elapsedMs = Date.now() - startTime;
      return {
        timestamp: new Date(),
        canTrade: false,
        reason: 'Insufficient buying power for position',
        marketRegime,
        direction,
        strikes,
        positionSize,
        executionReady: false,
        audit: this.audit,
        reasoningChain: this.reasoningAggregator.getSteps(),
        reasoningSummary: {
          ...this.reasoningAggregator.getSummary(),
          failedAtStep: 4,
          elapsedMs,
        },
      };
    }

    // Step 5: Exit Rules
    console.log('\n🚪 Step 5: Exit Rules');
    const stopLossMultiplier = this.config.stopLossMultiplier || 2.0;
    const exitRules = await defineExitRules(strikes, positionSize, stopLossMultiplier);
    this.addAudit(
      5,
      'Exit Rules',
      {
        expectedPremium: strikes.expectedPremium,
        contracts: positionSize.contracts,
        stopLossMultiplier,
      },
      exitRules,
      true,
      exitRules.reason, // Short string reason
      exitRules.reasoning // Full StepReasoning chain
    );

    console.log(`  Stop Loss Multiplier: ${exitRules.stopLossMultiplier}x`);
    console.log(`  Stop Loss Price: $${exitRules.stopLossPrice.toFixed(2)} per share`);
    console.log(`  Max Loss Amount: $${exitRules.stopLossAmount.toFixed(2)}`);
    console.log(`  Take Profit: ${exitRules.takeProfitPrice || 'None (let expire worthless)'}`);
    console.log(`  Max Hold Time: ${exitRules.maxHoldingTime} hours`);

    // Final decision
    const elapsedMs = Date.now() - startTime;
    console.log('\n' + '='.repeat(60));
    console.log('✅ TRADING DECISION COMPLETE - READY FOR MANUAL APPROVAL');
    console.log(`   Total reasoning time: ${elapsedMs}ms`);
    console.log('='.repeat(60));

    return {
      timestamp: new Date(),
      canTrade: true,
      marketRegime,
      direction,
      strikes,
      positionSize,
      exitRules,
      executionReady: true,
      audit: this.audit,
      reasoningChain: this.reasoningAggregator.getSteps(),
      reasoningSummary: {
        ...this.reasoningAggregator.getSummary(),
        elapsedMs,
      },
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
   * @returns JSON-serializable object with full reasoning chains
   */
  exportDecision(decision: TradingDecision): object {
    return {
      timestamp: decision.timestamp.toISOString(),
      canTrade: decision.canTrade,
      reason: decision.reason,
      summary: decision.canTrade ? {
        direction: decision.direction?.direction,
        bias: decision.direction?.bias,
        putStrike: decision.strikes?.putStrike?.strike,
        putDelta: decision.strikes?.putStrike?.delta,
        callStrike: decision.strikes?.callStrike?.strike,
        callDelta: decision.strikes?.callStrike?.delta,
        contracts: decision.positionSize?.contracts,
        expectedPremium: decision.strikes?.expectedPremium,
        marginRequired: decision.positionSize?.totalMarginRequired,
        stopLossMultiplier: decision.exitRules?.stopLossMultiplier,
        stopLossAmount: decision.exitRules?.stopLossAmount,
        stopLossPrice: decision.exitRules?.stopLossPrice,
      } : null,
      // Reasoning summary for quick overview
      reasoningSummary: decision.reasoningSummary,
      // Full audit trail with reasoning
      audit: decision.audit.map(entry => ({
        step: entry.step,
        name: entry.name,
        timestamp: entry.timestamp.toISOString(),
        passed: entry.passed,
        reason: entry.reason,
        // Include step reasoning summary if available
        confidence: entry.reasoning?.confidence,
        decision: entry.reasoning?.decision,
        warnings: entry.reasoning?.warnings,
        computationCount: entry.reasoning?.computations?.length || 0,
      })),
      // Full reasoning chain for transparency
      reasoningChain: decision.reasoningChain?.map(step => ({
        step: step.step,
        name: step.name,
        decision: step.decision,
        decisionEmoji: step.decisionEmoji,
        confidence: step.confidence,
        canProceed: step.canProceed,
        warnings: step.warnings,
        logicSteps: step.logic?.length || 0,
        computations: step.computations?.length || 0,
      })),
    };
  }
}

/**
 * Test the complete engine flow with real IBKR data
 * This test uses real market data - no hardcoded mock values
 */
export async function testEngine(): Promise<void> {
  console.log('Testing Complete Trading Engine with Real IBKR Data\n');

  // Create engine with real data configuration
  // underlyingPrice is not specified - will be fetched from IBKR
  const engine = new TradingEngine({
    riskProfile: 'BALANCED',
    underlyingSymbol: 'SPY',
    stopLossMultiplier: 2.0,
    mockMode: false, // Use real IBKR data
  });

  // Account info - in production, fetch from IBKR getAccount()
  const accountInfo: AccountInfo = {
    cashBalance: 100000,
    buyingPower: 666000,
    currentPositions: 0
  };

  console.log('Account Configuration:');
  console.log(`  Cash: $${accountInfo.cashBalance.toLocaleString()}`);
  console.log(`  Buying Power: $${accountInfo.buyingPower.toLocaleString()}`);
  console.log(`  Leverage: ${(accountInfo.buyingPower / accountInfo.cashBalance).toFixed(2)}x`);
  console.log(`  Risk Profile: BALANCED`);
  console.log(`  Stop Loss Multiplier: 2.0x`);

  // Execute trading decision with full reasoning chains
  const decision = await engine.executeTradingDecision(accountInfo);

  // Display summary
  console.log('\n' + '='.repeat(60));
  console.log('DECISION SUMMARY');
  console.log('='.repeat(60));
  console.log(engine.generateSummary(decision));

  // Display reasoning summary
  if (decision.reasoningSummary) {
    console.log('\n' + '='.repeat(60));
    console.log('REASONING SUMMARY');
    console.log('='.repeat(60));
    console.log(`  Total Steps: ${decision.reasoningSummary.totalSteps}`);
    console.log(`  Passed Steps: ${decision.reasoningSummary.passedSteps}`);
    console.log(`  Total Warnings: ${decision.reasoningSummary.totalWarnings}`);
    console.log(`  Total Computations: ${decision.reasoningSummary.totalComputations}`);
    console.log(`  Average Confidence: ${decision.reasoningSummary.averageConfidence.toFixed(1)}%`);
    console.log(`  Can Execute: ${decision.reasoningSummary.canExecute ? '✅ YES' : '❌ NO'}`);
    console.log(`  Elapsed Time: ${decision.reasoningSummary.elapsedMs}ms`);
    if (decision.reasoningSummary.failedAtStep) {
      console.log(`  Failed At Step: ${decision.reasoningSummary.failedAtStep}`);
    }
  }

  // Display reasoning chain
  if (decision.reasoningChain && decision.reasoningChain.length > 0) {
    console.log('\n' + '='.repeat(60));
    console.log('REASONING CHAIN (Transparency Log)');
    console.log('='.repeat(60));
    for (const step of decision.reasoningChain) {
      console.log(`\n  Step ${step.step}: ${step.name}`);
      console.log(`    ${step.decisionEmoji} ${step.decision}`);
      console.log(`    Confidence: ${step.confidence}%`);
      console.log(`    Can Proceed: ${step.canProceed ? '✅' : '❌'}`);
      console.log(`    Logic Steps: ${step.logic.length}`);
      console.log(`    Computations: ${step.computations.length}`);
      if (step.warnings.length > 0) {
        console.log(`    ⚠️ Warnings: ${step.warnings.join(', ')}`);
      }
    }
  }

  // Export for storage
  console.log('\n' + '='.repeat(60));
  console.log('EXPORTED DECISION (for logging/storage)');
  console.log('='.repeat(60));
  console.log(JSON.stringify(engine.exportDecision(decision), null, 2));
}

// Test function can be called from a separate test file