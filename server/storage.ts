// @ts-nocheck
// TODO: Add proper null checks for db
import {
  type User,
  type InsertUser,
  type Position,
  type InsertPosition,
  type Trade,
  type InsertTrade,
  type RiskRules,
  type InsertRiskRules,
  type AuditLog,
  type InsertAuditLog,
  type IbkrCredentials,
  type InsertIbkrCredentials,
  type Order,
  type InsertOrder,
  type Fill,
  type InsertFill,
  type GreeksSnapshot,
  type InsertGreeksSnapshot,
  type OptionChainData,
  type SpreadConfig,
  type TradeValidation,
  type ValidationResult,
  trades,
  auditLogs,
} from "@shared/schema";
import { randomUUID } from "crypto";
import { db } from "./db";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  // User management
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Position management
  getPositions(): Promise<Position[]>;
  getPosition(id: string): Promise<Position | undefined>;
  createPosition(position: InsertPosition): Promise<Position>;
  updatePosition(id: string, position: Partial<Position>): Promise<Position>;
  closePosition(id: string): Promise<void>;
  
  // Trade management
  getTrades(): Promise<Trade[]>;
  createTrade(trade: InsertTrade): Promise<Trade>;
  updateTradeStatus(id: string, status: string): Promise<Trade>;
  
  // Risk rules
  getRiskRules(): Promise<RiskRules[]>;
  getRiskRuleByName(name: string): Promise<RiskRules | undefined>;
  createOrUpdateRiskRules(rules: InsertRiskRules): Promise<RiskRules>;
  
  // Audit logs
  getAuditLogs(): Promise<AuditLog[]>;
  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  
  // Option chain data (mock for now)
  getOptionChain(symbol: string, expiration?: string): Promise<OptionChainData>;
  
  // Account data
  getAccountInfo(): Promise<{
    accountNumber: string;
    buyingPower: number;
    portfolioValue: number;
    netDelta: number;
    dayPnL: number;
    marginUsed: number;
    // Enhanced fields for Portfolio Row 2
    totalCash: number;
    settledCash: number;
    grossPositionValue: number;
    maintenanceMargin: number;
    cushion: number;
    leverage: number;
    excessLiquidity: number;
  }>;
  
  // Validation
  validateTrade(spreadConfig: SpreadConfig): Promise<TradeValidation>;

  // IBKR Credentials management
  getIbkrCredentials(userId: string, environment?: "paper" | "live"): Promise<IbkrCredentials | undefined>;
  getAllIbkrCredentials(userId: string): Promise<IbkrCredentials[]>;
  createIbkrCredentials(credentials: InsertIbkrCredentials): Promise<IbkrCredentials>;
  updateIbkrCredentials(id: string, updates: Partial<IbkrCredentials>): Promise<IbkrCredentials>;
  deleteIbkrCredentials(id: string): Promise<void>;
  updateIbkrConnectionStatus(id: string, status: "active" | "inactive" | "error", errorMessage?: string): Promise<void>;

  // Order tracking
  createOrder(order: InsertOrder): Promise<Order>;
  getOpenOrders(): Promise<Order[]>;
  getOrderByIbkrId(ibkrOrderId: string): Promise<Order | undefined>;
  updateOrderStatus(id: string, status: string, extras?: { filledAt?: Date; cancelledAt?: Date }): Promise<Order>;
  clearAllLocalOrders(): Promise<number>;

  // Fill tracking (comprehensive execution details)
  createFill(fill: InsertFill): Promise<Fill>;
  getFillsByOrderId(orderId: string): Promise<Fill[]>;
  getFillsByTradeId(tradeId: string): Promise<Fill[]>;

  // Greeks snapshots (track Greeks evolution)
  createGreeksSnapshot(snapshot: InsertGreeksSnapshot): Promise<GreeksSnapshot>;
  getGreeksSnapshotsByTradeId(tradeId: string): Promise<GreeksSnapshot[]>;

  // Enhanced trade operations
  updateTradeWithDetails(id: string, updates: Partial<Trade>): Promise<Trade>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User> = new Map();
  private positions: Map<string, Position> = new Map();
  private trades: Map<string, Trade> = new Map();
  private riskRules: Map<string, RiskRules> = new Map();
  private auditLogs: Map<string, AuditLog> = new Map();
  private ibkrCredentials: Map<string, IbkrCredentials> = new Map();
  private orders: Map<string, Order> = new Map();
  private fills: Map<string, Fill> = new Map();
  private greeksSnapshots: Map<string, GreeksSnapshot> = new Map();

  constructor() {
    // Initialize with default risk rules
    this.initializeDefaultRules();
  }

  private async initializeDefaultRules() {
    const defaultRules: InsertRiskRules = {
      name: "default",
      config: {
        trading_parameters: {
          spy_0dte: {
            delta_range: { min: 0.10, max: 0.30 },
            min_open_interest: 100,
            max_spread_width: 10.0,
            max_contracts_per_trade: 5
          },
          weekly_singles: {
            delta_range: { min: 0.15, max: 0.35 },
            min_open_interest: 50,
            max_spread_width: 15.0,
            max_contracts_per_trade: 3
          }
        },
        risk_limits: {
          portfolio_delta_limit: 2.50,
          max_margin_utilization: 0.80,
          max_position_size: 10000.00,
          symbol_limits: {
            SPY: 20,
            TSLA: 5,
            AAPL: 5,
            NVDA: 3,
            AMZN: 3
          }
        },
        validation_rules: {
          require_margin_check: true,
          require_delta_check: true,
          require_oi_check: true,
          allow_override: false
        },
        market_conditions: {
          trading_hours_only: true,
          exclude_earnings_week: true,
          max_vix_threshold: 30.0
        }
      },
      isActive: true
    };
    
    await this.createOrUpdateRiskRules(defaultRules);
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(user => user.username === username);
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async getPositions(): Promise<Position[]> {
    return Array.from(this.positions.values()).filter(p => p.status === "open");
  }

  async getPosition(id: string): Promise<Position | undefined> {
    return this.positions.get(id);
  }

  async createPosition(insertPosition: InsertPosition): Promise<Position> {
    const id = randomUUID();
    const position: Position = {
      ...insertPosition,
      id,
      openedAt: new Date(),
      status: "open"
    };
    this.positions.set(id, position);
    return position;
  }

  async updatePosition(id: string, update: Partial<Position>): Promise<Position> {
    const position = this.positions.get(id);
    if (!position) throw new Error("Position not found");
    
    const updated = { ...position, ...update };
    this.positions.set(id, updated);
    return updated;
  }

  async closePosition(id: string): Promise<void> {
    const position = this.positions.get(id);
    if (!position) throw new Error("Position not found");
    
    position.status = "closed";
    this.positions.set(id, position);
  }

  async getTrades(): Promise<Trade[]> {
    // Try database first, fall back to memory
    if (db) {
      try {
        const dbTrades = await db.select().from(trades).orderBy(desc(trades.submittedAt));
        console.log(`[Storage] Fetched ${dbTrades.length} trades from database`);
        return dbTrades;
      } catch (err) {
        console.error('[Storage] Failed to fetch trades from DB, using memory:', err);
      }
    }
    return Array.from(this.trades.values());
  }

  async createTrade(insertTrade: InsertTrade): Promise<Trade> {
    const id = randomUUID();
    const trade: Trade = {
      ...insertTrade,
      id,
      submittedAt: new Date()
    };

    // Save to memory
    this.trades.set(id, trade);

    // Also persist to database if available
    if (db) {
      try {
        await db.insert(trades).values({
          id: trade.id,
          symbol: trade.symbol,
          strategy: trade.strategy,
          sellStrike: trade.sellStrike,
          buyStrike: trade.buyStrike,
          expiration: trade.expiration,
          quantity: trade.quantity,
          credit: trade.credit,
          status: trade.status,
          // Entry details
          entryFillPrice: trade.entryFillPrice,
          entryCommission: trade.entryCommission,
          entryDelta: trade.entryDelta,
          entryGamma: trade.entryGamma,
          entryTheta: trade.entryTheta,
          entryVega: trade.entryVega,
          entryIv: trade.entryIv,
          entryUnderlyingPrice: trade.entryUnderlyingPrice,
          entryVix: trade.entryVix,
          // Risk context
          riskRegime: trade.riskRegime,
          targetDelta: trade.targetDelta,
          actualDelta: trade.actualDelta,
          contractCount: trade.contractCount,
        });
        console.log(`[Storage] ✅ Trade ${id} saved to database`);
      } catch (err) {
        console.error(`[Storage] ❌ Failed to save trade ${id} to database:`, err);
        // Don't throw - we still have it in memory
      }
    } else {
      console.warn(`[Storage] Database not available, trade ${id} only in memory`);
    }

    return trade;
  }

  async updateTradeStatus(id: string, status: string): Promise<Trade> {
    const trade = this.trades.get(id);
    if (!trade) throw new Error("Trade not found");

    trade.status = status;
    this.trades.set(id, trade);

    // Update in database if available
    if (db) {
      try {
        await db.update(trades).set({ status }).where(eq(trades.id, id));
        console.log(`[Storage] Updated trade ${id} status to ${status} in database`);
      } catch (err) {
        console.error(`[Storage] Failed to update trade ${id} status in database:`, err);
      }
    }

    return trade;
  }

  async getRiskRules(): Promise<RiskRules[]> {
    return Array.from(this.riskRules.values());
  }

  async getRiskRuleByName(name: string): Promise<RiskRules | undefined> {
    return Array.from(this.riskRules.values()).find(rule => rule.name === name);
  }

  async createOrUpdateRiskRules(insertRules: InsertRiskRules): Promise<RiskRules> {
    const existing = await this.getRiskRuleByName(insertRules.name);
    
    if (existing) {
      const updated: RiskRules = {
        ...existing,
        config: insertRules.config,
        isActive: insertRules.isActive ?? true,
        updatedAt: new Date()
      };
      this.riskRules.set(existing.id, updated);
      return updated;
    } else {
      const id = randomUUID();
      const rules: RiskRules = {
        ...insertRules,
        id,
        isActive: insertRules.isActive ?? true,
        updatedAt: new Date()
      };
      this.riskRules.set(id, rules);
      return rules;
    }
  }

  async getAuditLogs(): Promise<AuditLog[]> {
    // Try database first
    if (db) {
      try {
        const dbLogs = await db.select().from(auditLogs).orderBy(desc(auditLogs.timestamp)).limit(100);
        return dbLogs;
      } catch (err) {
        console.error('[Storage] Failed to fetch audit logs from DB:', err);
      }
    }
    return Array.from(this.auditLogs.values())
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  async createAuditLog(insertLog: InsertAuditLog): Promise<AuditLog> {
    const id = randomUUID();
    const log: AuditLog = {
      ...insertLog,
      id,
      userId: insertLog.userId || null,
      timestamp: new Date()
    };
    this.auditLogs.set(id, log);

    // Persist to database
    if (db) {
      try {
        await db.insert(auditLogs).values({
          id: log.id,
          eventType: log.action,  // Map 'action' field to 'event_type' column
          details: log.details,
          userId: log.userId,
          status: 'success',  // Default status for audit logs
        });
      } catch (err) {
        console.error('[Storage] Failed to save audit log to database:', err);
      }
    }

    return log;
  }

  async getOptionChain(symbol: string, expiration?: string): Promise<OptionChainData> {
    // Mock option chain data - in production this would come from broker API
    const basePrice = symbol === "SPY" ? 450.23 : 
                     symbol === "TSLA" ? 242.15 : 
                     symbol === "AAPL" ? 187.50 : 100.00;
    
    const strikes = [];
    for (let i = -20; i <= 20; i += 5) {
      strikes.push(basePrice + i);
    }

    const options = strikes.flatMap(strike => [
      {
        strike,
        type: "put" as const,
        bid: Math.max(0.01, (basePrice - strike) * 0.002 + Math.random() * 0.5),
        ask: Math.max(0.02, (basePrice - strike) * 0.002 + Math.random() * 0.5 + 0.02),
        delta: -Math.abs(Math.random() * 0.5),
        openInterest: Math.floor(Math.random() * 5000) + 100,
        expiration: expiration || new Date().toISOString().split('T')[0]
      },
      {
        strike,
        type: "call" as const,
        bid: Math.max(0.01, (strike - basePrice) * 0.002 + Math.random() * 0.5),
        ask: Math.max(0.02, (strike - basePrice) * 0.002 + Math.random() * 0.5 + 0.02),
        delta: Math.abs(Math.random() * 0.5),
        openInterest: Math.floor(Math.random() * 5000) + 100,
        expiration: expiration || new Date().toISOString().split('T')[0]
      }
    ]);

    return {
      symbol,
      underlyingPrice: basePrice,
      underlyingChange: (Math.random() - 0.5) * 10,
      options
    };
  }

  async getAccountInfo() {
    // IMPORTANT: Return null values instead of mock/hardcoded data
    // When IBKR is configured, this mock provider should NOT be used
    // If these values appear in the UI, it indicates a configuration issue
    // The user should see "-" in the UI when values are null (meaning "unavailable")
    return {
      accountNumber: null as unknown as string,
      buyingPower: null as unknown as number,
      portfolioValue: null as unknown as number,
      netDelta: null as unknown as number,
      dayPnL: null as unknown as number,
      marginUsed: null as unknown as number,
      // Enhanced fields for Portfolio Row 2
      totalCash: null as unknown as number,
      settledCash: null as unknown as number,
      grossPositionValue: null as unknown as number,
      maintenanceMargin: null as unknown as number,
      cushion: null as unknown as number,
      leverage: null as unknown as number,
      excessLiquidity: null as unknown as number
    };
  }

  async validateTrade(spreadConfig: SpreadConfig): Promise<TradeValidation> {
    const rules = await this.getRiskRuleByName("default");
    if (!rules) throw new Error("Risk rules not found");

    const positions = await this.getPositions();
    const account = await this.getAccountInfo();
    
    const results: ValidationResult[] = [];
    const marginRequired = (spreadConfig.sellLeg.strike - spreadConfig.buyLeg.strike) * 100 * spreadConfig.quantity;
    const deltaImpact = (spreadConfig.sellLeg.delta + spreadConfig.buyLeg.delta) * spreadConfig.quantity;

    // Margin check
    const marginAvailable = account.buyingPower;
    results.push({
      passed: marginRequired <= marginAvailable,
      type: "margin",
      message: marginRequired <= marginAvailable ? "Margin Check Passed" : "Insufficient margin",
      details: { required: marginRequired, available: marginAvailable }
    });

    // Delta limit check
    const newDelta = account.netDelta + deltaImpact;
    const deltaLimit = (rules.config as any).risk_limits.portfolio_delta_limit;
    results.push({
      passed: Math.abs(newDelta) <= deltaLimit,
      type: "delta",
      message: Math.abs(newDelta) <= deltaLimit ? "Delta Limit Check Passed" : "Delta limit exceeded",
      details: { impact: deltaImpact, newTotal: newDelta, limit: deltaLimit }
    });

    // Symbol limit check
    const symbolPositions = positions.filter(p => p.symbol === spreadConfig.symbol).length;
    const symbolLimit = (rules.config as any).risk_limits.symbol_limits[spreadConfig.symbol] || 1;
    results.push({
      passed: symbolPositions < symbolLimit,
      type: "symbol_limit",
      message: symbolPositions < symbolLimit ? "Symbol Limit Check Passed" : "Symbol position limit exceeded",
      details: { current: symbolPositions, limit: symbolLimit }
    });

    const allPassed = results.every(r => r.passed);
    const allowedContracts = allPassed ? spreadConfig.quantity : 0;

    return {
      results,
      allowedContracts,
      maxRisk: marginRequired,
      marginRequired,
      deltaImpact
    };
  }

  // IBKR Credentials management implementations
  async getIbkrCredentials(userId: string, environment: "paper" | "live" = "paper"): Promise<IbkrCredentials | undefined> {
    // Find credentials for the user with the specified environment
    for (const cred of this.ibkrCredentials.values()) {
      if (cred.userId === userId && cred.environment === environment) {
        return cred;
      }
    }
    return undefined;
  }

  async getAllIbkrCredentials(userId: string): Promise<IbkrCredentials[]> {
    const userCreds: IbkrCredentials[] = [];
    for (const cred of this.ibkrCredentials.values()) {
      if (cred.userId === userId) {
        userCreds.push(cred);
      }
    }
    return userCreds;
  }

  async createIbkrCredentials(credentials: InsertIbkrCredentials): Promise<IbkrCredentials> {
    const id = randomUUID();
    const now = new Date();

    const newCredentials: IbkrCredentials = {
      id,
      ...credentials,
      status: "inactive",
      lastConnectedAt: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    };

    this.ibkrCredentials.set(id, newCredentials);

    // Create audit log
    await this.createAuditLog({
      eventType: "ibkr_credentials_created",
      details: `IBKR credentials created for user ${credentials.userId} (${credentials.environment})`,
      userId: credentials.userId,
      status: "success",
    });

    return newCredentials;
  }

  async updateIbkrCredentials(id: string, updates: Partial<IbkrCredentials>): Promise<IbkrCredentials> {
    const existing = this.ibkrCredentials.get(id);
    if (!existing) {
      throw new Error(`IBKR credentials not found: ${id}`);
    }

    const updated: IbkrCredentials = {
      ...existing,
      ...updates,
      id: existing.id, // Ensure ID doesn't change
      userId: existing.userId, // Ensure user ID doesn't change
      updatedAt: new Date(),
    };

    this.ibkrCredentials.set(id, updated);

    // Create audit log
    await this.createAuditLog({
      eventType: "ibkr_credentials_updated",
      details: `IBKR credentials updated for user ${existing.userId}`,
      userId: existing.userId,
      status: "success",
    });

    return updated;
  }

  async deleteIbkrCredentials(id: string): Promise<void> {
    const existing = this.ibkrCredentials.get(id);
    if (!existing) {
      throw new Error(`IBKR credentials not found: ${id}`);
    }

    this.ibkrCredentials.delete(id);

    // Create audit log
    await this.createAuditLog({
      eventType: "ibkr_credentials_deleted",
      details: `IBKR credentials deleted for user ${existing.userId} (${existing.environment})`,
      userId: existing.userId,
      status: "success",
    });
  }

  async updateIbkrConnectionStatus(
    id: string,
    status: "active" | "inactive" | "error",
    errorMessage?: string
  ): Promise<void> {
    const existing = this.ibkrCredentials.get(id);
    if (!existing) {
      throw new Error(`IBKR credentials not found: ${id}`);
    }

    const updates: Partial<IbkrCredentials> = {
      status,
      errorMessage: errorMessage || null,
      lastConnectedAt: status === "active" ? new Date() : existing.lastConnectedAt,
      updatedAt: new Date(),
    };

    const updated = {
      ...existing,
      ...updates,
    };

    this.ibkrCredentials.set(id, updated);

    // Create audit log
    await this.createAuditLog({
      eventType: "ibkr_connection_status_changed",
      details: `IBKR connection status changed to ${status}${errorMessage ? `: ${errorMessage}` : ""}`,
      userId: existing.userId,
      status: status === "error" ? "error" : "success",
    });
  }

  // Order tracking implementations
  async createOrder(insertOrder: InsertOrder): Promise<Order> {
    const id = randomUUID();
    const order: Order = {
      ...insertOrder,
      id,
      submittedAt: new Date(),
      filledAt: null,
      cancelledAt: null,
    };
    this.orders.set(id, order);
    console.log(`[Storage] Created order: id=${id}, ibkrOrderId=${order.ibkrOrderId}, symbol=${order.symbol}, status=${order.status}`);
    return order;
  }

  async getOpenOrders(): Promise<Order[]> {
    const openStatuses = ['pending', 'submitted'];
    const openOrders = Array.from(this.orders.values())
      .filter(o => openStatuses.includes(o.status));
    console.log(`[Storage] Found ${openOrders.length} open orders (statuses: ${openStatuses.join(', ')})`);
    return openOrders;
  }

  async getOrderByIbkrId(ibkrOrderId: string): Promise<Order | undefined> {
    for (const order of this.orders.values()) {
      if (order.ibkrOrderId === ibkrOrderId) {
        return order;
      }
    }
    return undefined;
  }

  async updateOrderStatus(id: string, status: string, extras?: { filledAt?: Date; cancelledAt?: Date }): Promise<Order> {
    const order = this.orders.get(id);
    if (!order) throw new Error(`Order not found: ${id}`);

    const updated: Order = {
      ...order,
      status,
      filledAt: extras?.filledAt || order.filledAt,
      cancelledAt: extras?.cancelledAt || order.cancelledAt,
    };
    this.orders.set(id, updated);
    console.log(`[Storage] Updated order ${id} status to ${status}`);
    return updated;
  }

  async clearAllLocalOrders(): Promise<number> {
    const openOrders = await this.getOpenOrders();
    let cleared = 0;
    for (const order of openOrders) {
      await this.updateOrderStatus(order.id, 'cancelled', { cancelledAt: new Date() });
      cleared++;
    }
    console.log(`[Storage] Cleared ${cleared} local orders`);
    return cleared;
  }

  // ==================== FILL TRACKING ====================

  async createFill(fill: InsertFill): Promise<Fill> {
    const id = randomUUID();
    const newFill: Fill = {
      id,
      ...fill,
      createdAt: new Date(),
    };
    this.fills.set(id, newFill);
    console.log(`[Storage] Created fill ${id} for order ${fill.orderId}`);
    return newFill;
  }

  async getFillsByOrderId(orderId: string): Promise<Fill[]> {
    const result: Fill[] = [];
    for (const fill of this.fills.values()) {
      if (fill.orderId === orderId) {
        result.push(fill);
      }
    }
    return result.sort((a, b) => new Date(a.fillTime).getTime() - new Date(b.fillTime).getTime());
  }

  async getFillsByTradeId(tradeId: string): Promise<Fill[]> {
    const result: Fill[] = [];
    for (const fill of this.fills.values()) {
      if (fill.tradeId === tradeId) {
        result.push(fill);
      }
    }
    return result.sort((a, b) => new Date(a.fillTime).getTime() - new Date(b.fillTime).getTime());
  }

  // ==================== GREEKS SNAPSHOTS ====================

  async createGreeksSnapshot(snapshot: InsertGreeksSnapshot): Promise<GreeksSnapshot> {
    const id = randomUUID();
    const newSnapshot: GreeksSnapshot = {
      id,
      ...snapshot,
      createdAt: new Date(),
    };
    this.greeksSnapshots.set(id, newSnapshot);
    console.log(`[Storage] Created Greeks snapshot ${id} for trade ${snapshot.tradeId}`);
    return newSnapshot;
  }

  async getGreeksSnapshotsByTradeId(tradeId: string): Promise<GreeksSnapshot[]> {
    const result: GreeksSnapshot[] = [];
    for (const snapshot of this.greeksSnapshots.values()) {
      if (snapshot.tradeId === tradeId) {
        result.push(snapshot);
      }
    }
    return result.sort((a, b) => new Date(a.snapshotTime).getTime() - new Date(b.snapshotTime).getTime());
  }

  // ==================== ENHANCED TRADE OPERATIONS ====================

  async updateTradeWithDetails(id: string, updates: Partial<Trade>): Promise<Trade> {
    const trade = this.trades.get(id);
    if (!trade) throw new Error(`Trade not found: ${id}`);

    const updated: Trade = {
      ...trade,
      ...updates,
    };
    this.trades.set(id, updated);

    // Persist to database
    if (db) {
      try {
        await db.update(trades).set(updates).where(eq(trades.id, id));
        console.log(`[Storage] Updated trade ${id} with details in database:`, Object.keys(updates).join(', '));
      } catch (err) {
        console.error(`[Storage] Failed to update trade ${id} in database:`, err);
      }
    } else {
      console.log(`[Storage] Updated trade ${id} with details (memory only):`, Object.keys(updates).join(', '));
    }

    return updated;
  }
}

export const storage = new MemStorage();
