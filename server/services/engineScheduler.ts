/**
 * Engine Scheduler Service
 * Automated execution service for the 5-step trading engine
 *
 * Features:
 * - Auto-starts during trading window (11:00 AM - 1:00 PM ET, weekdays)
 * - Runs analysis every configurable interval (default: 5 minutes)
 * - Auto-executes trades when 5-step decision passes all guard rails
 * - Respects daily trade limit
 * - Logs all decisions and executions to audit trail
 */

import { TradingEngine } from '../engine/index';
import { getBroker } from '../broker/index';
import { ensureIbkrReady, placePaperOptionOrder } from '../broker/ibkr';
import { storage } from '../storage';

// Scheduler configuration
export interface SchedulerConfig {
  enabled: boolean;
  intervalMinutes: number; // How often to run analysis (1-10 minutes)
  tradingWindowStart: number; // Hour in ET (e.g., 12 for 12 PM)
  tradingWindowEnd: number; // Hour in ET (e.g., 14 for 2 PM)
  maxTradesPerDay: number; // Maximum trades to execute per day
  autoExecute: boolean; // Whether to auto-execute or just analyze
  symbol: string; // Underlying symbol (default: SPY)
}

export interface SchedulerStatus {
  isRunning: boolean;
  lastRunTime: Date | null;
  nextRunTime: Date | null;
  tradesToday: number;
  lastDecision: any | null;
  lastError: string | null;
  inTradingWindow: boolean;
}

// Default configuration
const DEFAULT_CONFIG: SchedulerConfig = {
  enabled: false,
  intervalMinutes: 5,
  tradingWindowStart: 11, // 11 AM ET
  tradingWindowEnd: 13, // 1 PM ET
  maxTradesPerDay: 3,
  autoExecute: true,
  symbol: 'SPY',
};

class EngineScheduler {
  private config: SchedulerConfig;
  private status: SchedulerStatus;
  private intervalId: NodeJS.Timeout | null = null;
  private engine: TradingEngine | null = null;
  private tradesTodayDate: string = ''; // Track which day the count is for

  constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.status = {
      isRunning: false,
      lastRunTime: null,
      nextRunTime: null,
      tradesToday: 0,
      lastDecision: null,
      lastError: null,
      inTradingWindow: false,
    };
  }

  /**
   * Initialize the scheduler with optional configuration
   */
  initialize(config?: Partial<SchedulerConfig>): void {
    if (config) {
      this.config = { ...this.config, ...config };
    }
    console.log('[EngineScheduler] Initialized with config:', this.config);
  }

  /**
   * Start the scheduler
   */
  start(): { success: boolean; message: string } {
    if (this.status.isRunning) {
      return { success: false, message: 'Scheduler is already running' };
    }

    this.config.enabled = true;
    this.status.isRunning = true;
    this.status.lastError = null;

    // Reset daily trade count if it's a new day
    const today = new Date().toISOString().slice(0, 10);
    if (this.tradesTodayDate !== today) {
      this.tradesTodayDate = today;
      this.status.tradesToday = 0;
    }

    // Calculate next run time
    this.scheduleNextRun();

    console.log('[EngineScheduler] Started');
    this.logAudit('SCHEDULER_STARTED', 'Engine scheduler started');

    return { success: true, message: 'Scheduler started successfully' };
  }

  /**
   * Stop the scheduler
   */
  stop(): { success: boolean; message: string } {
    if (!this.status.isRunning) {
      return { success: false, message: 'Scheduler is not running' };
    }

    this.config.enabled = false;
    this.status.isRunning = false;

    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }

    this.status.nextRunTime = null;

    console.log('[EngineScheduler] Stopped');
    this.logAudit('SCHEDULER_STOPPED', 'Engine scheduler stopped');

    return { success: true, message: 'Scheduler stopped successfully' };
  }

  /**
   * Update scheduler configuration
   */
  updateConfig(config: Partial<SchedulerConfig>): SchedulerConfig {
    this.config = { ...this.config, ...config };
    console.log('[EngineScheduler] Config updated:', this.config);

    // Reschedule if running
    if (this.status.isRunning) {
      this.scheduleNextRun();
    }

    return this.config;
  }

  /**
   * Get current scheduler status
   */
  getStatus(): SchedulerStatus & { config: SchedulerConfig } {
    // Update trading window status
    this.status.inTradingWindow = this.isInTradingWindow();

    return {
      ...this.status,
      config: this.config,
    };
  }

  /**
   * Check if current time is within trading window
   */
  private isInTradingWindow(): boolean {
    const now = new Date();

    // Convert to ET (EST/EDT)
    const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const hour = etTime.getHours();
    const dayOfWeek = etTime.getDay(); // 0 = Sunday, 6 = Saturday

    // Check if weekday (Mon-Fri)
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return false;
    }

    // Check if within trading window
    return hour >= this.config.tradingWindowStart && hour < this.config.tradingWindowEnd;
  }

  /**
   * Schedule the next run
   */
  private scheduleNextRun(): void {
    if (this.intervalId) {
      clearTimeout(this.intervalId);
    }

    const intervalMs = this.config.intervalMinutes * 60 * 1000;
    this.status.nextRunTime = new Date(Date.now() + intervalMs);

    this.intervalId = setTimeout(() => this.runCycle(), intervalMs);
  }

  /**
   * Run a single analysis cycle
   */
  async runCycle(): Promise<void> {
    if (!this.config.enabled || !this.status.isRunning) {
      return;
    }

    this.status.lastRunTime = new Date();

    try {
      // Reset daily count if new day
      const today = new Date().toISOString().slice(0, 10);
      if (this.tradesTodayDate !== today) {
        this.tradesTodayDate = today;
        this.status.tradesToday = 0;
      }

      // Check if in trading window
      if (!this.isInTradingWindow()) {
        console.log('[EngineScheduler] Outside trading window, skipping');
        this.scheduleNextRun();
        return;
      }

      // Check daily trade limit
      if (this.status.tradesToday >= this.config.maxTradesPerDay) {
        console.log(`[EngineScheduler] Daily trade limit reached (${this.status.tradesToday}/${this.config.maxTradesPerDay})`);
        this.scheduleNextRun();
        return;
      }

      console.log('[EngineScheduler] Running analysis cycle...');

      // Initialize engine if needed
      if (!this.engine) {
        this.engine = new TradingEngine();
      }

      // Ensure IBKR is ready
      const broker = getBroker();
      if (broker.status.provider === 'ibkr') {
        await ensureIbkrReady();
      }

      // Run 5-step analysis
      const decision = await this.engine.execute();
      this.status.lastDecision = decision;

      console.log('[EngineScheduler] Decision:', {
        executionReady: decision.executionReady,
        direction: decision.direction?.direction,
        contracts: decision.positionSize?.contracts,
        guardRailViolations: decision.guardRailViolations,
      });

      // Log the analysis
      await this.logAudit('SCHEDULER_ANALYSIS', JSON.stringify({
        executionReady: decision.executionReady,
        direction: decision.direction?.direction,
        marketCondition: decision.marketCondition,
      }));

      // Execute trade if conditions are met
      if (
        this.config.autoExecute &&
        decision.executionReady &&
        (!decision.guardRailViolations || decision.guardRailViolations.length === 0)
      ) {
        await this.executeTrade(decision);
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[EngineScheduler] Cycle error:', errorMsg);
      this.status.lastError = errorMsg;
      await this.logAudit('SCHEDULER_ERROR', errorMsg);
    }

    // Schedule next run
    this.scheduleNextRun();
  }

  /**
   * Execute a trade based on the decision
   */
  private async executeTrade(decision: any): Promise<void> {
    const broker = getBroker();
    const expiration = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    console.log('[EngineScheduler] Executing trade...');

    try {
      // Execute PUT order if present
      if (decision.strikes?.putStrike && decision.positionSize?.contracts > 0) {
        const putStrike = decision.strikes.putStrike;
        const contracts = decision.positionSize.contracts;
        const premium = putStrike.bid || 0.5;

        if (broker.status.provider === 'ibkr') {
          const result = await placePaperOptionOrder({
            symbol: this.config.symbol,
            optionType: 'PUT',
            strike: putStrike.strike,
            expiration,
            side: 'SELL',
            quantity: contracts,
            orderType: 'LMT',
            limitPrice: premium,
          });

          console.log('[EngineScheduler] PUT order result:', result);

          // Save trade to database
          const expirationDate = new Date();
          expirationDate.setHours(16, 0, 0, 0);

          await storage.createTrade({
            symbol: this.config.symbol,
            strategy: 'PUT',
            sellStrike: putStrike.strike.toString(),
            buyStrike: putStrike.strike.toString(),
            expiration: expirationDate,
            quantity: contracts,
            credit: (premium * contracts * 100).toString(),
            status: result.id ? 'pending' : 'mock',
          });

          this.status.tradesToday++;
        }
      }

      // Execute CALL order if present
      if (decision.strikes?.callStrike && decision.positionSize?.contracts > 0) {
        const callStrike = decision.strikes.callStrike;
        const contracts = decision.positionSize.contracts;
        const premium = callStrike.bid || 0.5;

        if (broker.status.provider === 'ibkr') {
          const result = await placePaperOptionOrder({
            symbol: this.config.symbol,
            optionType: 'CALL',
            strike: callStrike.strike,
            expiration,
            side: 'SELL',
            quantity: contracts,
            orderType: 'LMT',
            limitPrice: premium,
          });

          console.log('[EngineScheduler] CALL order result:', result);

          // Save trade to database
          const expirationDate = new Date();
          expirationDate.setHours(16, 0, 0, 0);

          await storage.createTrade({
            symbol: this.config.symbol,
            strategy: 'CALL',
            sellStrike: callStrike.strike.toString(),
            buyStrike: callStrike.strike.toString(),
            expiration: expirationDate,
            quantity: contracts,
            credit: (premium * contracts * 100).toString(),
            status: result.id ? 'pending' : 'mock',
          });

          this.status.tradesToday++;
        }
      }

      await this.logAudit('SCHEDULER_TRADE_EXECUTED', JSON.stringify({
        direction: decision.direction?.direction,
        putStrike: decision.strikes?.putStrike?.strike,
        callStrike: decision.strikes?.callStrike?.strike,
        contracts: decision.positionSize?.contracts,
      }));

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[EngineScheduler] Trade execution error:', errorMsg);
      this.status.lastError = errorMsg;
      await this.logAudit('SCHEDULER_TRADE_ERROR', errorMsg);
    }
  }

  /**
   * Log an audit entry
   */
  private async logAudit(action: string, details: string): Promise<void> {
    try {
      await storage.createAuditLog({
        action,
        details,
        userId: 'scheduler',
      });
    } catch (error) {
      console.error('[EngineScheduler] Failed to log audit:', error);
    }
  }

  /**
   * Manually trigger a single analysis run (for testing)
   */
  async runOnce(): Promise<any> {
    console.log('[EngineScheduler] Running single analysis...');

    try {
      if (!this.engine) {
        this.engine = new TradingEngine();
      }

      const broker = getBroker();
      if (broker.status.provider === 'ibkr') {
        await ensureIbkrReady();
      }

      const decision = await this.engine.execute();
      this.status.lastDecision = decision;
      this.status.lastRunTime = new Date();

      return decision;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.status.lastError = errorMsg;
      throw error;
    }
  }
}

// Singleton instance
export const engineScheduler = new EngineScheduler();

// Auto-start check on module load (if configured)
export function checkAutoStart(): void {
  // This can be called from server startup to check if scheduler should auto-start
  // For now, manual start is required via API
  console.log('[EngineScheduler] Module loaded. Call engineScheduler.start() to begin.');
}
