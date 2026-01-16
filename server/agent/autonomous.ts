import { v4 as uuidv4 } from 'uuid';
import { logger, LogType } from './logger';
import { memory } from './memory';
import { deepseekClient } from './models/deepseek';
import { kimiClient } from './models/kimi';
import { getBroker } from '../broker';
import { AgentContext, Decision } from './types';

// Guardrails - hard limits
const GUARDRAILS = {
  maxDailyLoss: 500,        // Max loss before stopping for the day
  maxContracts: 5,          // Max contracts per trade
  stopLossMultiplier: 3,    // 3x premium stop loss
  maxTradesPerDay: 1,       // Only 1 trade per day
  tradingWindowStart: 12,   // 12:00 PM ET baseline (but LLM can override)
  lastEntryTime: 15,        // 3:00 PM ET - no entries after this
  exitDeadline: 15.92,      // 3:55 PM ET - must be out
};

export class AutonomousAgent {
  private isRunning = false;

  async wakeUp(): Promise<void> {
    if (this.isRunning) {
      console.log('[Agent] Already running, skipping wake-up');
      return;
    }

    this.isRunning = true;
    const sessionId = uuidv4();

    try {
      // 1. Load context
      this.log(sessionId, 'WAKE', 'Loading context...');
      const context = await this.loadContext();

      if (!context) {
        this.log(sessionId, 'SLEEP', 'Market closed or broker not connected');
        return;
      }

      this.log(sessionId, 'DATA', this.formatContext(context));

      // 2. Store observation in memory
      await memory.storeObservation(sessionId, context);

      // 3. Ask DeepSeek for triage
      this.log(sessionId, 'THINK', 'Analyzing market conditions...');
      const recentMemory = await memory.getRecent(5);
      const triage = await deepseekClient.triage(context, recentMemory);
      this.log(sessionId, 'THINK', triage.reasoning);

      // 4. If escalation needed, call Kimi K2
      if (triage.escalate) {
        this.log(sessionId, 'ESCALATE', triage.reason);
        const decision = await kimiClient.decide(context, triage.reason);
        this.log(sessionId, 'DECIDE', this.formatDecision(decision));

        // Update memory with decision
        await memory.storeObservation(sessionId, context, triage, decision);

        // 5. Execute if decided to trade
        if (decision.action === 'TRADE' && decision.params) {
          await this.executeTrade(sessionId, decision, context);
        } else if (decision.action === 'CLOSE') {
          await this.closePosition(sessionId, context);
        }
      } else {
        this.log(sessionId, 'OBSERVE', triage.reason);
      }

      // 6. Sleep until next wake-up
      this.log(sessionId, 'SLEEP', `Next wake: ${this.getNextWakeTime()}`);

    } catch (error: any) {
      this.log(sessionId, 'ERROR', error.message);
    } finally {
      this.isRunning = false;
    }
  }

  private async loadContext(): Promise<AgentContext | null> {
    try {
      const broker = getBroker();

      if (!broker.api || !broker.status.connected) {
        return null;
      }

      // Get market data
      const spyData = await broker.api.getMarketData('SPY');
      const vixData = await broker.api.getMarketData('VIX');

      // Get account and positions
      const account = await broker.api.getAccount();
      const positions = await broker.api.getPositions();

      // Time calculations
      const now = new Date();
      const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const hours = etTime.getHours();
      const minutes = etTime.getMinutes();
      const currentTimeDecimal = hours + minutes / 60;
      const currentTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

      // Market hours check (9:30 AM - 4:00 PM ET)
      const isMarketOpen = currentTimeDecimal >= 9.5 && currentTimeDecimal < 16;

      // Trading window (12 PM is baseline, but LLM can override)
      const isTradingWindow = currentTimeDecimal >= GUARDRAILS.tradingWindowStart &&
                             currentTimeDecimal < GUARDRAILS.lastEntryTime;

      // Minutes until close
      const minutesUntilClose = Math.max(0, (16 - currentTimeDecimal) * 60);

      // Find current SPY option position if any
      // Positions from DB are credit spreads with sellStrike/buyStrike
      const spyPositions = positions.filter(p =>
        p.symbol === 'SPY' && p.status === 'open'
      );

      const hasPosition = spyPositions.length > 0;
      let currentPosition;

      if (hasPosition && spyPositions[0]) {
        const pos = spyPositions[0];
        const sellStrike = parseFloat(pos.sellStrike);
        const openCredit = parseFloat(pos.openCredit);
        const currentValue = parseFloat(pos.currentValue);
        const unrealizedPnl = openCredit - currentValue;

        currentPosition = {
          type: pos.strategy === 'put_credit' ? 'PUT' : 'CALL' as 'PUT' | 'CALL',
          strike: sellStrike,
          contracts: pos.quantity,
          entryPrice: openCredit / pos.quantity / 100, // Per-contract premium
          currentPrice: currentValue / pos.quantity / 100,
          unrealizedPnl,
          stopLossPrice: (openCredit / pos.quantity / 100) * GUARDRAILS.stopLossMultiplier,
        };
      }

      // Get today's stats
      const todayStats = await memory.getTodayStats();

      return {
        spyPrice: spyData.price,
        vixLevel: vixData.price,
        currentTime,
        isMarketOpen,
        isTradingWindow,
        minutesUntilClose,
        hasPosition,
        currentPosition,
        tradesToday: todayStats.trades,
        dailyPnl: todayStats.pnl,
        maxDailyLoss: GUARDRAILS.maxDailyLoss,
        maxContracts: GUARDRAILS.maxContracts,
        stopLossMultiplier: GUARDRAILS.stopLossMultiplier,
      };
    } catch (error: any) {
      console.error('[Agent] Failed to load context:', error.message);
      return null;
    }
  }

  private formatContext(context: AgentContext): string {
    const parts = [
      `SPY=${context.spyPrice.toFixed(2)}`,
      `VIX=${context.vixLevel.toFixed(1)}`,
      `positions=${context.hasPosition ? 1 : 0}`,
      `trades=${context.tradesToday}`,
    ];

    if (context.currentPosition) {
      parts.push(`pnl=$${context.currentPosition.unrealizedPnl.toFixed(0)}`);
    }

    return parts.join(' ');
  }

  private formatDecision(decision: Decision): string {
    if (decision.action === 'TRADE' && decision.params) {
      return `Execute: ${decision.params.contracts}x ${decision.params.strike}${decision.params.direction[0]} | ${decision.reasoning.substring(0, 100)}`;
    }
    return `${decision.action}: ${decision.reasoning.substring(0, 150)}`;
  }

  private async executeTrade(
    sessionId: string,
    decision: Decision,
    context: AgentContext
  ): Promise<void> {
    if (!decision.params) {
      this.log(sessionId, 'ERROR', 'No trade params provided');
      return;
    }

    // Validate guardrails
    if (context.tradesToday >= GUARDRAILS.maxTradesPerDay) {
      this.log(sessionId, 'ERROR', `Max trades (${GUARDRAILS.maxTradesPerDay}) reached for today`);
      return;
    }

    if (context.dailyPnl < -GUARDRAILS.maxDailyLoss) {
      this.log(sessionId, 'ERROR', `Daily loss limit ($${GUARDRAILS.maxDailyLoss}) reached`);
      return;
    }

    const contracts = Math.min(decision.params.contracts, GUARDRAILS.maxContracts);

    // Log the tool call
    this.log(sessionId, 'TOOL', `execute_trade | ${decision.params.direction} ${decision.params.strike} x${contracts}`);

    try {
      const broker = getBroker();
      if (!broker.api) {
        throw new Error('Broker not available');
      }

      // Get option chain to find the actual option
      const chain = await broker.api.getOptionChain('SPY');
      const targetStrike = decision.params.strike;
      const targetType = decision.params.direction.toLowerCase() as 'put' | 'call';

      // Find matching option
      const options = targetType === 'put'
        ? chain.options.filter(o => o.type === 'put')
        : chain.options.filter(o => o.type === 'call');

      const targetOption = options.find(o => o.strike === targetStrike);

      if (!targetOption) {
        throw new Error(`No option found at strike ${targetStrike}`);
      }

      // Execute the trade (SELL to open)
      // Note: This is simplified - actual implementation would handle order placement
      this.log(sessionId, 'ACTION', `SELL ${contracts}x SPY ${targetStrike}${targetType[0].toUpperCase()} @ $${targetOption.bid.toFixed(2)} | premium=$${(targetOption.bid * contracts * 100).toFixed(0)}`);

      // In production, would call broker.api.placeOrder() here

    } catch (error: any) {
      this.log(sessionId, 'ERROR', `Trade execution failed: ${error.message}`);
    }
  }

  private async closePosition(sessionId: string, context: AgentContext): Promise<void> {
    if (!context.hasPosition) {
      this.log(sessionId, 'ERROR', 'No position to close');
      return;
    }

    this.log(sessionId, 'TOOL', 'close_position | Closing current position');

    try {
      // In production, would call broker API to close
      this.log(sessionId, 'ACTION', `CLOSE position | pnl=$${context.currentPosition?.unrealizedPnl.toFixed(0)}`);
    } catch (error: any) {
      this.log(sessionId, 'ERROR', `Close position failed: ${error.message}`);
    }
  }

  private getNextWakeTime(): string {
    const now = new Date();
    const next = new Date(now.getTime() + 15 * 60 * 1000); // 15 minutes
    return next.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'America/New_York',
    });
  }

  private log(sessionId: string, type: LogType, message: string): void {
    logger.log({ sessionId, type, message });
  }
}

// Singleton
export const agent = new AutonomousAgent();
