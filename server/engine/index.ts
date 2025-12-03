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
import { selectDirection, DirectionDecision } from './step2.ts';
import { selectStrikes, StrikeSelection } from './step3.ts';
import { calculatePositionSize, PositionSize, RiskProfile, AccountInfo } from './step4.ts';
import { defineExitRules, ExitRules } from './step5.ts';

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
 * Engine configuration
 */
export interface EngineConfig {
  riskProfile: RiskProfile;
  underlyingSymbol: string;
  underlyingPrice?: number; // If not provided, will fetch from market
  mockMode?: boolean;       // Use mock data for testing
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
   * Execute the complete 5-step trading decision process
   * @param accountInfo - Current account information
   * @returns Complete trading decision with audit trail
   */
  async executeTradingDecision(accountInfo: AccountInfo): Promise<TradingDecision> {
    console.log('\n' + '='.repeat(60));
    console.log('APEYOLO TRADING ENGINE - DECISION PROCESS');
    console.log('='.repeat(60));

    // Reset audit trail
    this.audit = [];

    // Step 1: Market Regime Check
    console.log('\n📊 Step 1: Market Regime Check');
    const marketRegime = await analyzeMarketRegime();
    const withinTradingWindow = marketRegime.withinTradingWindow;
    const canExecute = marketRegime.canExecute;

    // Determine step 1 result for audit (pass if VIX is acceptable, regardless of trading window)
    const step1Passed = marketRegime.shouldTrade;
    this.addAudit(1, 'Market Regime Check', {}, marketRegime, step1Passed, marketRegime.reason);

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
    console.log('\n🎯 Step 2: Direction Selection');
    const direction = await selectDirection(marketRegime);
    this.addAudit(2, 'Direction Selection', { marketRegime }, direction, true, direction.reasoning);
    console.log(`  Direction: ${direction.direction}`);
    console.log(`  Confidence: ${(direction.confidence * 100).toFixed(0)}%`);
    console.log(`  Reasoning: ${direction.reasoning}`);

    // Step 3: Strike Selection
    console.log('\n🎲 Step 3: Strike Selection');
    // Use REAL SPY price from Step 1 (IBKR only - no fallbacks)
    const underlyingPrice = marketRegime.metadata?.spyPrice || 0;

    if (!underlyingPrice || underlyingPrice <= 0) {
      throw new Error('[IBKR] No SPY price available from Step 1 - cannot proceed without real IBKR data');
    }
    console.log(`  Using SPY price: $${underlyingPrice.toFixed(2)} (source: Step 1 IBKR)`);

    const strikes = await selectStrikes(direction.direction, underlyingPrice);
    this.addAudit(3, 'Strike Selection', { direction: direction.direction, underlyingPrice }, strikes, true, strikes.reasoning);

    if (strikes.putStrike) {
      console.log(`  PUT Strike: $${strikes.putStrike.strike} (delta: ${strikes.putStrike.delta})`);
    }
    if (strikes.callStrike) {
      console.log(`  CALL Strike: $${strikes.callStrike.strike} (delta: ${strikes.callStrike.delta})`);
    }
    console.log(`  Expected Premium: $${strikes.expectedPremium}`);

    // Step 4: Position Sizing
    console.log('\n📏 Step 4: Position Sizing');
    const positionSize = await calculatePositionSize(strikes, accountInfo, this.config.riskProfile);
    this.addAudit(4, 'Position Sizing', { strikes, accountInfo, riskProfile: this.config.riskProfile }, positionSize, positionSize.contracts > 0, positionSize.reasoning);

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
    console.log('\n🚪 Step 5: Exit Rules');
    const exitRules = await defineExitRules(strikes, positionSize);
    this.addAudit(5, 'Exit Rules', { strikes, positionSize }, exitRules, true, exitRules.reasoning);

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
      audit: this.audit
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