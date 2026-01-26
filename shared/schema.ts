import { relations, sql } from "drizzle-orm";
import { pgTable, text, varchar, decimal, integer, timestamp, boolean, jsonb, bigint, index, doublePrecision, uniqueIndex, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  name: text("name"),
  picture: text("picture"),
  googleId: text("google_id").unique(),
  username: text("username").unique(), // Keep for backward compatibility, now optional
  password: text("password"), // Keep for backward compatibility, now optional
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const positions = pgTable("positions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }), // Multi-tenant: nullable for migration
  symbol: text("symbol").notNull(),
  strategy: text("strategy").notNull(), // "put_credit" | "call_credit"
  sellStrike: decimal("sell_strike", { precision: 10, scale: 2 }).notNull(),
  buyStrike: decimal("buy_strike", { precision: 10, scale: 2 }).notNull(),
  expiration: timestamp("expiration").notNull(),
  quantity: integer("quantity").notNull(),
  openCredit: decimal("open_credit", { precision: 10, scale: 2 }).notNull(),
  currentValue: decimal("current_value", { precision: 10, scale: 2 }).notNull(),
  delta: decimal("delta", { precision: 10, scale: 4 }).notNull(),
  marginRequired: decimal("margin_required", { precision: 10, scale: 2 }).notNull(),
  openedAt: timestamp("opened_at").notNull().defaultNow(),
  status: text("status").notNull().default("open"), // "open" | "closed"
});

export const trades = pgTable("trades", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }), // Multi-tenant: nullable for migration
  symbol: text("symbol").notNull(),
  strategy: text("strategy").notNull(),
  sellStrike: decimal("sell_strike", { precision: 10, scale: 2 }).notNull(),
  buyStrike: decimal("buy_strike", { precision: 10, scale: 2 }).notNull(),
  expiration: timestamp("expiration").notNull(),
  quantity: integer("quantity").notNull(),
  credit: decimal("credit", { precision: 10, scale: 2 }).notNull(),
  status: text("status").notNull(), // "pending" | "filled" | "rejected" | "closed"
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),

  // === ENTRY DETAILS (nullable for backward compatibility) ===
  entryFillPrice: doublePrecision("entry_fill_price"),
  entryCommission: doublePrecision("entry_commission"),
  entryDelta: doublePrecision("entry_delta"),
  entryGamma: doublePrecision("entry_gamma"),
  entryTheta: doublePrecision("entry_theta"),
  entryVega: doublePrecision("entry_vega"),
  entryIv: doublePrecision("entry_iv"),
  entryUnderlyingPrice: doublePrecision("entry_underlying_price"),
  entryVix: doublePrecision("entry_vix"),

  // === EXIT DETAILS ===
  exitFillPrice: doublePrecision("exit_fill_price"),
  exitCommission: doublePrecision("exit_commission"),
  exitDelta: doublePrecision("exit_delta"),
  exitGamma: doublePrecision("exit_gamma"),
  exitTheta: doublePrecision("exit_theta"),
  exitVega: doublePrecision("exit_vega"),
  exitIv: doublePrecision("exit_iv"),
  exitUnderlyingPrice: doublePrecision("exit_underlying_price"),
  exitVix: doublePrecision("exit_vix"),
  exitReason: text("exit_reason"), // "profit_target" | "stop_loss" | "time_stop" | "manual" | "expiration"
  closedAt: timestamp("closed_at"),

  // === P&L BREAKDOWN ===
  grossPnl: doublePrecision("gross_pnl"),
  totalCommissions: doublePrecision("total_commissions"),
  totalFees: doublePrecision("total_fees"),
  netPnl: doublePrecision("net_pnl"),

  // === RISK CONTEXT AT ENTRY ===
  riskRegime: text("risk_regime"), // 'LOW' | 'NORMAL' | 'ELEVATED' | 'HIGH' | 'EXTREME'
  targetDelta: doublePrecision("target_delta"),
  actualDelta: doublePrecision("actual_delta"),
  contractCount: integer("contract_count"),

  // === AGENT REASONING (for knowledge learning) ===
  agentReasoning: text("agent_reasoning"),      // DeepSeek's reasoning for this trade
  criticApproval: boolean("critic_approval"),   // Did Qwen approve?
  patternId: varchar("pattern_id"),             // Which pattern triggered this trade
});

export const riskRules = pgTable("risk_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  config: jsonb("config").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventType: text("event_type").notNull(),
  details: text("details").notNull(),
  userId: text("user_id"),
  status: text("status").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

// Orders table for tracking IBKR orders locally
export const orders = pgTable("orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }), // Multi-tenant: nullable for migration
  ibkrOrderId: varchar("ibkr_order_id", { length: 50 }),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(), // "BUY" | "SELL"
  quantity: integer("quantity").notNull(),
  orderType: text("order_type").notNull(), // "MKT" | "LMT"
  limitPrice: decimal("limit_price", { precision: 10, scale: 2 }),
  status: text("status").notNull(), // "pending" | "submitted" | "filled" | "cancelled" | "rejected"
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
  filledAt: timestamp("filled_at"),
  cancelledAt: timestamp("cancelled_at"),
});

// ==================== COMPREHENSIVE TRADE TRACKING ====================
// Fills table - Granular execution tracking for live orders
export const fills = pgTable("fills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: "cascade" }), // Multi-tenant: nullable for migration
  orderId: varchar("order_id").references(() => orders.id, { onDelete: "set null" }),
  tradeId: varchar("trade_id").references(() => trades.id, { onDelete: "set null" }),

  // Execution details
  fillTime: timestamp("fill_time").notNull(),
  fillPrice: doublePrecision("fill_price").notNull(),
  fillQuantity: integer("fill_quantity").notNull(),
  executionId: text("execution_id"), // IBKR execution ID

  // Costs
  commission: doublePrecision("commission").default(0),
  fees: doublePrecision("fees").default(0), // SEC, exchange fees

  // Greeks at fill time
  deltaAtFill: doublePrecision("delta_at_fill"),
  gammaAtFill: doublePrecision("gamma_at_fill"),
  thetaAtFill: doublePrecision("theta_at_fill"),
  vegaAtFill: doublePrecision("vega_at_fill"),
  ivAtFill: doublePrecision("iv_at_fill"),

  // Market state at fill
  underlyingPriceAtFill: doublePrecision("underlying_price_at_fill"),
  vixAtFill: doublePrecision("vix_at_fill"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("fills_order_id_idx").on(table.orderId),
  index("fills_trade_id_idx").on(table.tradeId),
  index("fills_fill_time_idx").on(table.fillTime),
]);

// Greeks snapshots - Track Greeks evolution over trade lifetime
export const greeksSnapshots = pgTable("greeks_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tradeId: varchar("trade_id").references(() => trades.id, { onDelete: "cascade" }),

  snapshotTime: timestamp("snapshot_time").notNull(),

  // Current Greeks
  delta: doublePrecision("delta"),
  gamma: doublePrecision("gamma"),
  theta: doublePrecision("theta"),
  vega: doublePrecision("vega"),
  iv: doublePrecision("iv"),

  // Market state
  optionPrice: doublePrecision("option_price"),
  underlyingPrice: doublePrecision("underlying_price"),
  vix: doublePrecision("vix"),

  // Time context
  dte: doublePrecision("dte"), // Days to expiration

  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("greeks_snapshots_trade_id_idx").on(table.tradeId),
  index("greeks_snapshots_time_idx").on(table.snapshotTime),
]);

// ==================== END COMPREHENSIVE TRADE TRACKING ====================

// IBKR Credentials table for user-specific broker authentication
export const ibkrCredentials = pgTable("ibkr_credentials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull(),
  clientKeyId: text("client_key_id").notNull(),
  privateKeyEncrypted: text("private_key_encrypted").notNull(), // Encrypted with AES-256-GCM
  credential: text("credential").notNull(), // IBKR username
  accountId: text("account_id"),
  allowedIp: text("allowed_ip"),
  environment: text("environment", { enum: ["paper", "live"] }).notNull().default("paper"),
  status: text("status", { enum: ["active", "inactive", "error"] }).notNull().default("inactive"),
  lastConnectedAt: timestamp("last_connected_at"),
  errorMessage: text("error_message"),
  // Runtime OAuth tokens (encrypted, survive restarts)
  accessTokenEncrypted: text("access_token_encrypted"),
  accessTokenExpiryMs: bigint("access_token_expiry_ms", { mode: "number" }),
  ssoTokenEncrypted: text("sso_token_encrypted"),
  ssoSessionId: text("sso_session_id"),
  ssoTokenExpiryMs: bigint("sso_token_expiry_ms", { mode: "number" }),
  cookieJarJson: text("cookie_jar_json"), // Serialized cookie jar
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Market data table for OHLC time-series (VIX, SPY, etc.)
// Structured for AI model consumption and historical analysis
export const marketData = pgTable("market_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull(), // VIX, SPY, etc.
  timestamp: timestamp("timestamp").notNull(),
  open: decimal("open", { precision: 12, scale: 4 }).notNull(),
  high: decimal("high", { precision: 12, scale: 4 }).notNull(),
  low: decimal("low", { precision: 12, scale: 4 }).notNull(),
  close: decimal("close", { precision: 12, scale: 4 }).notNull(),
  volume: bigint("volume", { mode: "number" }),
  interval: text("interval").notNull(), // 1m, 5m, 15m, 1h, 1d
  source: text("source").notNull().default("yahoo"), // yahoo, ibkr
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  // Composite indexes for efficient AI queries
  index("market_data_symbol_timestamp_idx").on(table.symbol, table.timestamp),
  index("market_data_symbol_interval_timestamp_idx").on(table.symbol, table.interval, table.timestamp),
]);

// Insert schemas
export const insertPositionSchema = createInsertSchema(positions).omit({
  id: true,
  openedAt: true,
});

export const insertTradeSchema = createInsertSchema(trades).omit({
  id: true,
  submittedAt: true,
});

export const insertRiskRulesSchema = createInsertSchema(riskRules).omit({
  id: true,
  updatedAt: true,
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  timestamp: true,
});

export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  name: true,
  picture: true,
  googleId: true,
  username: true,
  password: true,
});

export const insertIbkrCredentialsSchema = createInsertSchema(ibkrCredentials).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastConnectedAt: true,
  errorMessage: true,
  status: true,
});

export const insertOrderSchema = createInsertSchema(orders).omit({
  id: true,
  submittedAt: true,
  filledAt: true,
  cancelledAt: true,
});

export const insertFillSchema = createInsertSchema(fills).omit({
  id: true,
  createdAt: true,
});

export const insertGreeksSnapshotSchema = createInsertSchema(greeksSnapshots).omit({
  id: true,
  createdAt: true,
});

export const insertMarketDataSchema = createInsertSchema(marketData).omit({
  id: true,
  createdAt: true,
});

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Position = typeof positions.$inferSelect;
export type InsertPosition = z.infer<typeof insertPositionSchema>;
export type Trade = typeof trades.$inferSelect;
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type RiskRules = typeof riskRules.$inferSelect;
export type InsertRiskRules = z.infer<typeof insertRiskRulesSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type IbkrCredentials = typeof ibkrCredentials.$inferSelect;
export type InsertIbkrCredentials = z.infer<typeof insertIbkrCredentialsSchema>;
export type Order = typeof orders.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Fill = typeof fills.$inferSelect;
export type InsertFill = z.infer<typeof insertFillSchema>;
export type GreeksSnapshot = typeof greeksSnapshots.$inferSelect;
export type InsertGreeksSnapshot = z.infer<typeof insertGreeksSnapshotSchema>;
export type MarketData = typeof marketData.$inferSelect;
export type InsertMarketData = z.infer<typeof insertMarketDataSchema>;

// Paper trades table for tracking paper trade proposals
export const paperTrades = pgTable("paper_trades", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  proposalId: varchar("proposal_id", { length: 50 }).notNull(),

  // Trade details
  symbol: text("symbol").notNull(),
  strategy: text("strategy").notNull(),  // PUT | CALL | STRANGLE
  bias: text("bias").notNull(),           // BULL | BEAR | NEUTRAL
  expiration: timestamp("expiration").notNull(),
  expirationLabel: text("expiration_label").notNull(),

  // Position
  contracts: integer("contracts").notNull(),

  // Leg 1 (always present)
  leg1Type: text("leg1_type").notNull(),
  leg1Strike: decimal("leg1_strike", { precision: 10, scale: 2 }).notNull(),
  leg1Delta: decimal("leg1_delta", { precision: 10, scale: 4 }).notNull(),
  leg1Premium: decimal("leg1_premium", { precision: 10, scale: 4 }).notNull(),

  // Leg 2 (nullable, for strangles)
  leg2Type: text("leg2_type"),
  leg2Strike: decimal("leg2_strike", { precision: 10, scale: 2 }),
  leg2Delta: decimal("leg2_delta", { precision: 10, scale: 4 }),
  leg2Premium: decimal("leg2_premium", { precision: 10, scale: 4 }),

  // Economics
  entryPremiumTotal: decimal("entry_premium_total", { precision: 10, scale: 2 }).notNull(),
  marginRequired: decimal("margin_required", { precision: 10, scale: 2 }).notNull(),
  maxLoss: decimal("max_loss", { precision: 10, scale: 2 }).notNull(),

  // Exit rules
  stopLossPrice: decimal("stop_loss_price", { precision: 10, scale: 4 }).notNull(),
  stopLossMultiplier: decimal("stop_loss_multiplier", { precision: 4, scale: 1 }).notNull(),
  timeStopEt: text("time_stop_et").notNull(),

  // Market context at entry
  entryVix: decimal("entry_vix", { precision: 10, scale: 2 }),
  entryVixRegime: text("entry_vix_regime"),
  entrySpyPrice: decimal("entry_spy_price", { precision: 10, scale: 2 }),
  riskProfile: text("risk_profile").notNull(),

  // Status tracking
  status: text("status").notNull().default("open"),  // open | closed | expired
  exitPrice: decimal("exit_price", { precision: 10, scale: 4 }),
  exitReason: text("exit_reason"),
  realizedPnl: decimal("realized_pnl", { precision: 10, scale: 2 }),

  // Commission & P&L breakdown
  entryCommission: doublePrecision("entry_commission"),
  exitCommission: doublePrecision("exit_commission"),
  totalCommissions: doublePrecision("total_commissions"),
  grossPnl: doublePrecision("gross_pnl"),
  netPnl: doublePrecision("net_pnl"),

  // IBKR integration
  ibkrOrderIds: jsonb("ibkr_order_ids"),  // Array of order IDs from IBKR

  // Audit
  userId: varchar("user_id").references(() => users.id),
  fullProposal: jsonb("full_proposal"),   // Complete TradeProposal JSON for audit

  // Validation (for P&L verification against actual spot prices)
  spotPriceAtClose: decimal("spot_price_at_close", { precision: 10, scale: 2 }),
  validationStatus: text("validation_status").default("pending"),  // pending | verified | discrepancy

  // Assignment tracking (when ITM option is exercised)
  assignmentDetails: jsonb("assignment_details"),  // { sharesAssigned, assignmentPrice, liquidationOrderId, liquidationPrice, liquidationTime, netAssignmentPnl }

  // Solana on-chain recording
  solanaSignature: text("solana_signature"),  // Transaction signature after on-chain recording

  createdAt: timestamp("created_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
});

export const insertPaperTradeSchema = createInsertSchema(paperTrades).omit({
  id: true,
  createdAt: true,
  closedAt: true,
});

export type PaperTrade = typeof paperTrades.$inferSelect;
export type InsertPaperTrade = z.infer<typeof insertPaperTradeSchema>;

// ==================== JOBS SYSTEM ====================
// Scheduled jobs with Cloud Scheduler integration

// Job definitions - what jobs exist and their schedules
export const jobs = pgTable("jobs", {
  id: text("id").primaryKey(), // 'market-close-options', 'daily-data-ingest'
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull(), // 'option-chain-capture', 'data-ingestion'
  schedule: text("schedule").notNull(), // Cron expression: "55 15 * * 1-5" (3:55 PM ET)
  timezone: text("timezone").notNull().default("America/New_York"),
  enabled: boolean("enabled").notNull().default(true),
  config: jsonb("config"), // Job-specific configuration (e.g., { symbol: 'SPY' })
  lastRunAt: timestamp("last_run_at"),
  lastRunStatus: text("last_run_status"), // 'success' | 'failed' | 'skipped'
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Job execution history - every run is logged
export const jobRuns = pgTable("job_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: text("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  status: text("status").notNull(), // 'pending', 'running', 'success', 'failed', 'skipped'
  triggeredBy: text("triggered_by").notNull().default("scheduler"), // 'scheduler' | 'manual'
  startedAt: timestamp("started_at").notNull().defaultNow(),
  endedAt: timestamp("ended_at"),
  durationMs: integer("duration_ms"),
  result: jsonb("result"), // Success data or error details
  error: text("error"), // Error message if failed
  marketDay: text("market_day"), // YYYY-MM-DD for idempotency check
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("job_runs_job_id_idx").on(table.jobId),
  index("job_runs_started_at_idx").on(table.startedAt),
  index("job_runs_market_day_idx").on(table.jobId, table.marketDay),
]);

// Option chain snapshots captured by jobs
export const optionChainSnapshots = pgTable("option_chain_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobRunId: varchar("job_run_id").references(() => jobRuns.id, { onDelete: "set null" }),
  symbol: varchar("symbol", { length: 10 }).notNull(),
  capturedAt: timestamp("captured_at").notNull().defaultNow(),
  marketDay: text("market_day").notNull(), // YYYY-MM-DD
  underlyingPrice: decimal("underlying_price", { precision: 10, scale: 2 }),
  vix: decimal("vix", { precision: 6, scale: 2 }),
  expiration: text("expiration"), // Expiration date captured
  chainData: jsonb("chain_data"), // Full { puts: [], calls: [] } arrays
  metadata: jsonb("metadata"), // Additional context (market regime, etc.)
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("option_chain_snapshots_symbol_idx").on(table.symbol),
  index("option_chain_snapshots_market_day_idx").on(table.symbol, table.marketDay),
  index("option_chain_snapshots_captured_at_idx").on(table.capturedAt),
]);

// Insert schemas for jobs
export const insertJobSchema = createInsertSchema(jobs).omit({
  createdAt: true,
  updatedAt: true,
  lastRunAt: true,
  lastRunStatus: true,
});

export const insertJobRunSchema = createInsertSchema(jobRuns).omit({
  id: true,
  createdAt: true,
  startedAt: true,
  endedAt: true,
  durationMs: true,
});

export const insertOptionChainSnapshotSchema = createInsertSchema(optionChainSnapshots).omit({
  id: true,
  createdAt: true,
  capturedAt: true,
});

// Types for jobs
export type Job = typeof jobs.$inferSelect;
export type InsertJob = z.infer<typeof insertJobSchema>;
export type JobRun = typeof jobRuns.$inferSelect;
export type InsertJobRun = z.infer<typeof insertJobRunSchema>;
export type OptionChainSnapshot = typeof optionChainSnapshots.$inferSelect;
export type InsertOptionChainSnapshot = z.infer<typeof insertOptionChainSnapshotSchema>;

// ==================== END JOBS SYSTEM ====================

// ==================== OPTION BARS (5-min OHLC for backtesting) ====================
// Stores 5-minute option OHLC bars for historical backtesting
// OHLC comes from WebSocket when available, otherwise snapshot_only from HTTP

export const optionBars = pgTable('option_bars', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  symbol: text('symbol').notNull(),
  strike: decimal('strike', { precision: 10, scale: 2 }).notNull(),
  expiry: text('expiry').notNull(), // YYYYMMDD format
  optionType: text('option_type').notNull(), // 'PUT' | 'CALL'
  intervalStart: timestamp('interval_start').notNull(),

  // OHLC (from WebSocket tick tracking)
  open: decimal('open', { precision: 10, scale: 4 }),
  high: decimal('high', { precision: 10, scale: 4 }),
  low: decimal('low', { precision: 10, scale: 4 }),
  close: decimal('close', { precision: 10, scale: 4 }),

  // Snapshot data (always captured)
  bidClose: decimal('bid_close', { precision: 10, scale: 4 }),
  askClose: decimal('ask_close', { precision: 10, scale: 4 }),

  // Greeks at close
  delta: decimal('delta', { precision: 8, scale: 6 }),
  gamma: decimal('gamma', { precision: 8, scale: 6 }),
  theta: decimal('theta', { precision: 8, scale: 6 }),
  vega: decimal('vega', { precision: 8, scale: 6 }),
  iv: decimal('iv', { precision: 8, scale: 6 }),
  openInterest: integer('open_interest'),

  // Data quality tracking
  dataQuality: text('data_quality').notNull(), // 'complete', 'partial', 'snapshot_only'
  tickCount: integer('tick_count').default(0),

  // Underlying context
  underlyingPrice: decimal('underlying_price', { precision: 10, scale: 4 }),
  vix: decimal('vix', { precision: 8, scale: 4 }),

  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ([
  // Prevent duplicates - one bar per option per interval
  uniqueIndex('idx_option_bars_unique').on(
    table.symbol, table.strike, table.expiry, table.optionType, table.intervalStart
  ),
  // Query performance for time-series lookups
  index('idx_option_bars_symbol_time').on(table.symbol, table.intervalStart),
]));

export const insertOptionBarSchema = createInsertSchema(optionBars).omit({
  id: true,
  createdAt: true,
});

export type OptionBar = typeof optionBars.$inferSelect;
export type InsertOptionBar = z.infer<typeof insertOptionBarSchema>;

// Continuous job status tracking (for 5-minute capture job observability)
export const continuousJobStatus = pgTable('continuous_job_status', {
  id: text('id').primaryKey(), // 'option-data-capture'
  isRunning: boolean('is_running').default(false),
  lastCaptureAt: timestamp('last_capture_at'),
  lastCaptureResult: text('last_capture_result'), // 'success', 'error'
  lastError: text('last_error'),
  captureCountToday: integer('capture_count_today').default(0),
  completeCount: integer('complete_count').default(0),
  partialCount: integer('partial_count').default(0),
  snapshotOnlyCount: integer('snapshot_only_count').default(0),
  wsConnected: boolean('ws_connected').default(false),
  marketDay: text('market_day'), // YYYY-MM-DD
  updatedAt: timestamp('updated_at').defaultNow(),
});

export type ContinuousJobStatus = typeof continuousJobStatus.$inferSelect;

// ==================== END OPTION BARS ====================

// ==================== ECONOMIC EVENTS ====================
// Macroeconomic calendar from FRED API

export const economicEvents = pgTable("economic_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventType: text("event_type").notNull(), // 'fomc', 'cpi', 'ppi', 'gdp', 'employment', 'pce'
  eventName: text("event_name").notNull(), // 'FOMC Press Release', 'Consumer Price Index'
  eventDate: text("event_date").notNull(), // YYYY-MM-DD
  eventTime: text("event_time"), // HH:MM ET (e.g., '08:30', '14:00')
  releaseId: integer("release_id"), // FRED release ID for reference
  impactLevel: text("impact_level").notNull().default("high"), // 'low', 'medium', 'high', 'critical'
  description: text("description"),
  source: text("source").notNull().default("fred"), // 'fred', 'manual', 'fed_calendar'
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("economic_events_date_idx").on(table.eventDate),
  index("economic_events_type_date_idx").on(table.eventType, table.eventDate),
]);

export const insertEconomicEventSchema = createInsertSchema(economicEvents).omit({
  id: true,
  createdAt: true,
  fetchedAt: true,
});

export type EconomicEvent = typeof economicEvents.$inferSelect;
export type InsertEconomicEvent = z.infer<typeof insertEconomicEventSchema>;

// ==================== END ECONOMIC EVENTS ====================

// ==================== EARNINGS CALENDAR ====================
// Earnings announcements from Alpha Vantage API

export const earningsCalendar = pgTable("earnings_calendar", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull(), // AAPL, NVDA, etc.
  companyName: text("company_name").notNull(),
  reportDate: text("report_date").notNull(), // YYYY-MM-DD
  fiscalQuarter: text("fiscal_quarter"), // Q1 2024, Q2 2024, etc.
  estimate: decimal("estimate", { precision: 10, scale: 4 }), // EPS estimate
  actual: decimal("actual", { precision: 10, scale: 4 }), // EPS actual
  currency: text("currency").default("USD"),
  source: text("source").notNull().default("alpha_vantage"),
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("earnings_calendar_date_idx").on(table.reportDate),
  index("earnings_calendar_symbol_idx").on(table.symbol),
  index("earnings_calendar_symbol_date_idx").on(table.symbol, table.reportDate),
]);

export const insertEarningsCalendarSchema = createInsertSchema(earningsCalendar).omit({
  id: true,
  createdAt: true,
  fetchedAt: true,
});

export type EarningsCalendarEvent = typeof earningsCalendar.$inferSelect;
export type InsertEarningsCalendarEvent = z.infer<typeof insertEarningsCalendarSchema>;

// ==================== END EARNINGS CALENDAR ====================

// ==================== CASH FLOWS ====================
// Track deposits and withdrawals for accurate performance calculation

export const cashFlows = pgTable("cash_flows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: text("date").notNull(), // YYYY-MM-DD
  type: text("type").notNull(), // 'deposit' | 'withdrawal'
  amount: decimal("amount", { precision: 12, scale: 2 }).notNull(),
  description: text("description"),
  userId: varchar("user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("cash_flows_date_idx").on(table.date),
  index("cash_flows_type_idx").on(table.type),
]);

export const insertCashFlowSchema = createInsertSchema(cashFlows).omit({
  id: true,
  createdAt: true,
});

export type CashFlow = typeof cashFlows.$inferSelect;
export type InsertCashFlow = z.infer<typeof insertCashFlowSchema>;

// ==================== END CASH FLOWS ====================

// ==================== NAV SNAPSHOTS ====================
// NAV snapshots for accurate Day P&L calculation (marked-to-market)
// Opening snapshots at 9:30 AM ET, closing snapshots at 4:15 PM ET

export const navSnapshots = pgTable("nav_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  date: text("date").notNull(), // YYYY-MM-DD
  snapshotType: text("snapshot_type").notNull().default("closing"), // 'opening' (9:30 AM) | 'closing' (4:15 PM)
  nav: decimal("nav", { precision: 12, scale: 2 }).notNull(),
  userId: varchar("user_id").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("nav_snapshots_date_idx").on(table.date),
  index("nav_snapshots_date_type_idx").on(table.date, table.snapshotType),
]);

export const insertNavSnapshotSchema = createInsertSchema(navSnapshots).omit({
  id: true,
  createdAt: true,
});

export type NavSnapshot = typeof navSnapshots.$inferSelect;
export type InsertNavSnapshot = z.infer<typeof insertNavSnapshotSchema>;

// ==================== END NAV SNAPSHOTS ====================

// ==================== DEFI RAILS ====================
// Blockchain-enforced trading rules for self-discipline and investor transparency

export const defiRails = pgTable("defi_rails", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),

  // Rules
  allowedSymbols: jsonb("allowed_symbols").notNull(), // ["SPY", "SPX"]
  strategyType: text("strategy_type").notNull(), // "SELL"
  minDelta: decimal("min_delta", { precision: 4, scale: 2 }), // 0.20
  maxDelta: decimal("max_delta", { precision: 4, scale: 2 }), // 0.35
  maxDailyLossPercent: decimal("max_daily_loss_percent", { precision: 5, scale: 4 }), // 0.02 = 2%
  noOvernightPositions: boolean("no_overnight_positions").notNull().default(true),
  exitDeadline: text("exit_deadline"), // "15:55" (3:55 PM ET)
  tradingWindowStart: text("trading_window_start"), // "12:00" (guideline only)
  tradingWindowEnd: text("trading_window_end"), // "14:00" (guideline only)

  // Metadata
  isActive: boolean("is_active").notNull().default(true),
  isLocked: boolean("is_locked").notNull().default(true), // Cannot modify once created

  // On-chain commitment (Solana)
  onChainHash: text("on_chain_hash"), // SHA256 hash of rail rules
  solanaSignature: text("solana_signature"), // Transaction signature
  solanaSlot: bigint("solana_slot", { mode: "number" }), // Slot when committed

  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("defi_rails_user_id_idx").on(table.userId),
  index("defi_rails_active_idx").on(table.userId, table.isActive),
]);

export const railViolations = pgTable("rail_violations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  railId: varchar("rail_id").notNull().references(() => defiRails.id, { onDelete: "cascade" }),

  // Violation details
  violationType: text("violation_type").notNull(), // "symbol", "delta", "strategy", "overnight", "daily_loss"
  attemptedValue: text("attempted_value"), // e.g., "ARM" or "0.45"
  limitValue: text("limit_value"), // e.g., "SPY,SPX" or "0.35"
  actionTaken: text("action_taken").notNull(), // "blocked"

  // Context
  tradeDetails: jsonb("trade_details"), // Full trade context at time of violation

  // On-chain proof (Solana)
  onChainHash: text("on_chain_hash"), // SHA256 hash of violation details
  solanaSignature: text("solana_signature"), // Transaction signature
  solanaSlot: bigint("solana_slot", { mode: "number" }), // Slot when recorded

  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("rail_violations_user_id_idx").on(table.userId),
  index("rail_violations_rail_id_idx").on(table.railId),
  index("rail_violations_created_at_idx").on(table.createdAt),
]);

export const insertDefiRailSchema = createInsertSchema(defiRails).omit({
  id: true,
  createdAt: true,
  onChainHash: true,
  solanaSignature: true,
  solanaSlot: true,
});

export const insertRailViolationSchema = createInsertSchema(railViolations).omit({
  id: true,
  createdAt: true,
  onChainHash: true,
  solanaSignature: true,
  solanaSlot: true,
});

export type DefiRail = typeof defiRails.$inferSelect;
export type InsertDefiRail = z.infer<typeof insertDefiRailSchema>;
export type RailViolation = typeof railViolations.$inferSelect;
export type InsertRailViolation = z.infer<typeof insertRailViolationSchema>;

// ==================== END DEFI RAILS ====================

// ==================== RAIL EVENTS (Blockchain Tracking) ====================

export const railEvents = pgTable("rail_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  railId: varchar("rail_id").references(() => defiRails.id, { onDelete: "set null" }),

  eventType: text("event_type").notNull(), // RAIL_CREATED, RAIL_DEACTIVATED, VIOLATION_BLOCKED, COMMITMENT_RECORDED
  eventData: jsonb("event_data").notNull(),
  eventHash: text("event_hash").notNull(), // SHA256 of event data

  previousRailId: varchar("previous_rail_id").references(() => defiRails.id, { onDelete: "set null" }),
  relatedViolationId: varchar("related_violation_id").references(() => railViolations.id, { onDelete: "set null" }),

  actorId: varchar("actor_id").notNull(),
  actorRole: text("actor_role").notNull().default("owner"),

  solanaSignature: text("solana_signature"),
  solanaSlot: bigint("solana_slot", { mode: "number" }),
  solanaCluster: text("solana_cluster").default("devnet"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  recordedOnChainAt: timestamp("recorded_on_chain_at"),
}, (table) => [
  index("rail_events_user_id_idx").on(table.userId),
  index("rail_events_rail_id_idx").on(table.railId),
  index("rail_events_type_idx").on(table.eventType),
  index("rail_events_created_at_idx").on(table.createdAt),
]);

export const insertRailEventSchema = createInsertSchema(railEvents).omit({
  id: true,
  createdAt: true,
  recordedOnChainAt: true,
  solanaSignature: true,
  solanaSlot: true,
});

export type RailEvent = typeof railEvents.$inferSelect;
export type InsertRailEvent = z.infer<typeof insertRailEventSchema>;

// ==================== END RAIL EVENTS ====================

// ==================== AGENT KNOWLEDGE BASE ====================
// Knowledge tables for the autonomous trading agent's learning system

// Patterns - learned market conditions and their outcomes
export const patterns = pgTable("patterns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),                 // "Low VIX Morning Entry"
  conditions: jsonb("conditions"),              // { vixMin: 12, vixMax: 18, timeStart: "10:00", timeEnd: "12:00" }
  recommendation: text("recommendation"),       // "Sell strangles at 0.15 delta"
  trades: integer("trades").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  totalPnl: decimal("total_pnl", { precision: 12, scale: 2 }).notNull().default("0"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("patterns_active_idx").on(table.isActive),
]);

// Lessons - trader insights and agent learnings
export const lessons = pgTable("lessons", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  content: text("content").notNull(),           // "Close before 3pm on Fridays"
  source: text("source").notNull(),             // "trader" | "analysis"
  category: text("category"),                   // "timing" | "risk" | "entry" | "exit"
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("lessons_active_idx").on(table.isActive),
  index("lessons_source_idx").on(table.source),
]);

// Agent Ticks - log of every autonomous tick
export const agentTicks = pgTable("agent_ticks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tickTime: timestamp("tick_time").notNull(),
  marketContext: jsonb("market_context"),       // { vix, spyPrice, hasPosition, marketHours }
  decision: text("decision").notNull(),         // "WAIT" | "HOLD" | "ANALYZE" | "PROPOSE" | "MANAGE"
  reasoning: text("reasoning"),                 // DeepSeek's thinking (if called)
  modelUsed: text("model_used"),                // Which model made the decision
  proposalId: varchar("proposal_id"),           // Link to paper_trades if proposed
  durationMs: integer("duration_ms"),           // How long the tick took
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("agent_ticks_time_idx").on(table.tickTime),
  index("agent_ticks_decision_idx").on(table.decision),
]);

// Insert schemas for knowledge tables
export const insertPatternSchema = createInsertSchema(patterns).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertLessonSchema = createInsertSchema(lessons).omit({
  id: true,
  createdAt: true,
});

export const insertAgentTickSchema = createInsertSchema(agentTicks).omit({
  id: true,
  createdAt: true,
});

// Types for knowledge tables
export type Pattern = typeof patterns.$inferSelect;
export type InsertPattern = z.infer<typeof insertPatternSchema>;
export type Lesson = typeof lessons.$inferSelect;
export type InsertLesson = z.infer<typeof insertLessonSchema>;
export type AgentTick = typeof agentTicks.$inferSelect;
export type InsertAgentTick = z.infer<typeof insertAgentTickSchema>;

// ==================== END AGENT KNOWLEDGE BASE ====================

// ==================== AUTONOMOUS AGENT (APE AGENT) ====================
// Logs and observations for the autonomous trading agent

// Agent logs - structured pipe-delimited entries
export const agentLogs = pgTable("agent_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: text("session_id").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  type: text("type").notNull(), // WAKE, DATA, THINK, TOOL, OBSERVE, ESCALATE, DECIDE, ACTION, SLEEP, ERROR
  message: text("message").notNull(),
}, (table) => [
  index("agent_logs_session_id_idx").on(table.sessionId),
  index("agent_logs_timestamp_idx").on(table.timestamp),
  index("agent_logs_type_idx").on(table.type),
]);

// Agent observations - market context snapshots
export const agentObservations = pgTable("agent_observations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sessionId: text("session_id").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
  spyPrice: doublePrecision("spy_price"),
  vixLevel: doublePrecision("vix_level"),
  positions: jsonb("positions"), // Current position summary
  context: jsonb("context"), // Full context JSON for LLM consumption
}, (table) => [
  index("agent_observations_session_id_idx").on(table.sessionId),
  index("agent_observations_timestamp_idx").on(table.timestamp),
]);

// Insert schemas for autonomous agent
export const insertAgentLogSchema = createInsertSchema(agentLogs).omit({
  id: true,
});

export const insertAgentObservationSchema = createInsertSchema(agentObservations).omit({
  id: true,
});

// Types for autonomous agent
export type AgentLog = typeof agentLogs.$inferSelect;
export type InsertAgentLog = z.infer<typeof insertAgentLogSchema>;
export type AgentObservation = typeof agentObservations.$inferSelect;
export type InsertAgentObservation = z.infer<typeof insertAgentObservationSchema>;

// ==================== END AUTONOMOUS AGENT ====================

// ==================== ENGINE RUNS (RLHF TRACKING) ====================
// Tracks every engine run for RLHF - links user adjustments and trade outcomes to AI decisions

export const engineRuns = pgTable("engine_runs", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id", { length: 36 }).references(() => users.id),

  // Trade setup
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(), // PUT | CALL | STRANGLE
  expirationMode: text("expiration_mode"), // 0DTE | WEEKLY

  // Original engine output (before your adjustments)
  originalPutStrike: doublePrecision("original_put_strike"),
  originalCallStrike: doublePrecision("original_call_strike"),
  originalPutDelta: doublePrecision("original_put_delta"),
  originalCallDelta: doublePrecision("original_call_delta"),

  // Your final adjustments
  finalPutStrike: doublePrecision("final_put_strike"),
  finalCallStrike: doublePrecision("final_call_strike"),
  adjustmentCount: integer("adjustment_count").default(0),

  // Market context at time of decision
  underlyingPrice: doublePrecision("underlying_price"),
  vix: doublePrecision("vix"),

  // Computed indicators (what AI sees)
  indicators: jsonb("indicators"), // { rsi: 65, macd: 0.5, sma20: 450, ... }

  // Full engine output for reference
  engineOutput: jsonb("engine_output"),

  // Outcome (filled when trade closes)
  tradeId: varchar("trade_id", { length: 36 }).references(() => trades.id, { onDelete: "set null" }),
  realizedPnl: doublePrecision("realized_pnl"),
  exitReason: text("exit_reason"),
  wasWinner: boolean("was_winner"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
}, (table) => [
  index("engine_runs_user_id_idx").on(table.userId),
  index("engine_runs_created_at_idx").on(table.createdAt),
]);

export const engineRunsRelations = relations(engineRuns, ({ one }) => ({
  user: one(users, { fields: [engineRuns.userId], references: [users.id] }),
  trade: one(trades, { fields: [engineRuns.tradeId], references: [trades.id] }),
}));

export const insertEngineRunSchema = createInsertSchema(engineRuns).omit({
  id: true,
  createdAt: true,
  closedAt: true,
});

export type EngineRun = typeof engineRuns.$inferSelect;
export type InsertEngineRun = z.infer<typeof insertEngineRunSchema>;

// ==================== END ENGINE RUNS ====================

// ==================== DIRECTION PREDICTIONS (AI Learning) ====================
// Tracks AI direction suggestions vs user choices, enabling the AI to learn from when users override its suggestions

export const directionPredictions = pgTable("direction_predictions", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  engineRunId: varchar("engine_run_id", { length: 36 }).references(() => engineRuns.id),

  // What indicators suggested
  indicatorSignal: text("indicator_signal"), // PUT | CALL | STRANGLE | NEUTRAL
  indicatorConfidence: doublePrecision("indicator_confidence"),
  indicatorReasoning: jsonb("indicator_reasoning"), // { rsi: "overbought", macd: "bearish cross", ... }

  // What AI suggested (learned model)
  aiSuggestion: text("ai_suggestion"),
  aiConfidence: doublePrecision("ai_confidence"),

  // What you actually chose
  userChoice: text("user_choice").notNull(),
  userReasoning: text("user_reasoning"), // WHY you made this choice - this is your edge

  // Did you agree with AI?
  agreedWithAi: boolean("agreed_with_ai"),
  agreedWithIndicators: boolean("agreed_with_indicators"),

  // This is your edge - when you disagree and are right
  wasOverride: boolean("was_override"), // You disagreed with AI
  overrideWasCorrect: boolean("override_was_correct"), // And you were right

  // Outcome
  pnl: doublePrecision("pnl"),
  wasCorrect: boolean("was_correct"), // Did the chosen direction make money?

  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("direction_predictions_engine_run_idx").on(table.engineRunId),
  index("direction_predictions_created_idx").on(table.createdAt),
]);

export const insertDirectionPredictionSchema = createInsertSchema(directionPredictions).omit({
  id: true,
  createdAt: true,
});
export type DirectionPrediction = typeof directionPredictions.$inferSelect;
export type InsertDirectionPrediction = z.infer<typeof insertDirectionPredictionSchema>;

// ==================== END DIRECTION PREDICTIONS ====================

// ==================== INDICATOR SNAPSHOTS ====================
// Stores computed technical indicators (RSI, MACD, etc.) so the AI can reference historical market conditions

export const indicatorSnapshots = pgTable("indicator_snapshots", {
  id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull(),

  // Price data
  price: doublePrecision("price").notNull(),
  open: doublePrecision("open"),
  high: doublePrecision("high"),
  low: doublePrecision("low"),
  volume: doublePrecision("volume"),

  // Trend indicators
  sma20: doublePrecision("sma_20"),
  sma50: doublePrecision("sma_50"),
  ema9: doublePrecision("ema_9"),
  ema21: doublePrecision("ema_21"),

  // Momentum indicators
  rsi14: doublePrecision("rsi_14"),
  macd: doublePrecision("macd"),
  macdSignal: doublePrecision("macd_signal"),
  macdHistogram: doublePrecision("macd_histogram"),

  // Volatility
  atr14: doublePrecision("atr_14"),
  bollingerUpper: doublePrecision("bollinger_upper"),
  bollingerLower: doublePrecision("bollinger_lower"),

  // Market context
  vix: doublePrecision("vix"),

  // Derived signals
  trendDirection: text("trend_direction"), // UP | DOWN | SIDEWAYS
  momentumSignal: text("momentum_signal"), // BULLISH | BEARISH | NEUTRAL
  volatilityRegime: text("volatility_regime"), // LOW | NORMAL | HIGH

  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("indicator_snapshots_symbol_idx").on(table.symbol),
  index("indicator_snapshots_created_idx").on(table.createdAt),
]);

export const insertIndicatorSnapshotSchema = createInsertSchema(indicatorSnapshots).omit({
  id: true,
  createdAt: true,
});
export type IndicatorSnapshot = typeof indicatorSnapshots.$inferSelect;
export type InsertIndicatorSnapshot = z.infer<typeof insertIndicatorSnapshotSchema>;

// ==================== END INDICATOR SNAPSHOTS ====================

// ==================== RLHF TRAINING EXAMPLES ====================

/**
 * Training examples for the RLHF model.
 *
 * Each row represents a historical trading day snapshot with:
 * - Market conditions at decision time (11 AM snapshot)
 * - The actual outcome (what happened by 4 PM)
 * - The optimal direction and efficiency score
 *
 * This data comes from Theta historical options data and is used
 * to train the Global Edge model.
 */
export const trainingExamples = pgTable("training_examples", {
  id: varchar("id", { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),

  // When this snapshot was taken
  date: timestamp("date").notNull(),
  snapshotTime: text("snapshot_time").notNull(), // e.g., "11:00:00"

  // Market snapshot at decision time (features)
  snapshot: jsonb("snapshot").notNull(), // { ohlcBars: [...], indicators: {...}, vix: number }

  // Underlying price at snapshot time
  underlyingPrice: doublePrecision("underlying_price").notNull(),
  vix: doublePrecision("vix"),

  // What actually happened (labels)
  actualOutcome: doublePrecision("actual_outcome").notNull(), // % change by 4 PM
  intradayHigh: doublePrecision("intraday_high"),
  intradayLow: doublePrecision("intraday_low"),

  // Optimal trade parameters
  optimalDirection: text("optimal_direction").notNull(), // PUT | CALL | STRANGLE | NO_TRADE
  conviction: text("conviction").notNull(), // STRONG | MEDIUM | WEAK
  optimalStrike: doublePrecision("optimal_strike"), // Best strike given outcome

  // Efficiency scoring
  theoreticalMaxPnl: doublePrecision("theoretical_max_pnl"), // Best possible P&L
  efficiencyScore: doublePrecision("efficiency_score"), // 0-1, how close to optimal

  // Source tracking
  source: text("source").notNull().default('theta'), // 'theta' | 'live' | 'backfill'

  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("training_examples_date_idx").on(table.date),
  index("training_examples_direction_idx").on(table.optimalDirection),
]);

export const insertTrainingExampleSchema = createInsertSchema(trainingExamples).omit({
  id: true,
  createdAt: true,
});
export type TrainingExample = typeof trainingExamples.$inferSelect;
export type InsertTrainingExample = z.infer<typeof insertTrainingExampleSchema>;

// ==================== END RLHF TRAINING EXAMPLES ====================

// ==================== LIVE DATA CAPTURE (DD Page) ====================

/**
 * Live 1-minute candles - captured in real-time during market hours
 * ~1 GB/year for SPY at 1-minute resolution
 */
export const liveCandles = pgTable("live_candles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: varchar("symbol", { length: 10 }).notNull(),
  timestamp: timestamp("timestamp").notNull(),
  open: doublePrecision("open").notNull(),
  high: doublePrecision("high").notNull(),
  low: doublePrecision("low").notNull(),
  close: doublePrecision("close").notNull(),
  volume: bigint("volume", { mode: 'number' }),
}, (table) => [
  uniqueIndex("live_candles_symbol_timestamp_idx").on(table.symbol, table.timestamp),
]);

export const insertLiveCandleSchema = createInsertSchema(liveCandles).omit({
  id: true,
});
export type LiveCandle = typeof liveCandles.$inferSelect;
export type InsertLiveCandle = z.infer<typeof insertLiveCandleSchema>;

/**
 * Live 1-minute options snapshots - captured alongside candles
 */
export const liveOptions = pgTable("live_options", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: varchar("symbol", { length: 10 }).notNull(),
  timestamp: timestamp("timestamp").notNull(),
  strike: doublePrecision("strike").notNull(),
  right: varchar("right", { length: 4 }).notNull(), // PUT/CALL
  bid: doublePrecision("bid"),
  ask: doublePrecision("ask"),
  delta: doublePrecision("delta"),
  gamma: doublePrecision("gamma"),
  theta: doublePrecision("theta"),
  vega: doublePrecision("vega"),
  iv: doublePrecision("iv"),
  volume: integer("volume"),
  openInterest: integer("open_interest"),
}, (table) => [
  uniqueIndex("live_options_idx").on(table.symbol, table.timestamp, table.strike, table.right),
]);

export const insertLiveOptionSchema = createInsertSchema(liveOptions).omit({
  id: true,
});
export type LiveOption = typeof liveOptions.$inferSelect;
export type InsertLiveOption = z.infer<typeof insertLiveOptionSchema>;

// ==================== END LIVE DATA CAPTURE ====================

// ==================== TRAINING MODE (DD Page) ====================

/**
 * Research observations - logged during Research mode when exploring patterns
 */
export const observations = pgTable("observations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  symbol: varchar("symbol", { length: 10 }).notNull(),
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
  timestamp: varchar("timestamp", { length: 5 }).notNull(), // HH:MM
  direction: varchar("direction", { length: 20 }).notNull(),
  confidence: varchar("confidence", { length: 10 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("observations_user_idx").on(table.userId),
  index("observations_date_idx").on(table.date),
]);

export const insertObservationSchema = createInsertSchema(observations).omit({
  id: true,
  createdAt: true,
});
export type Observation = typeof observations.$inferSelect;
export type InsertObservation = z.infer<typeof insertObservationSchema>;

/**
 * Training decisions - logged during Train mode with fixed time windows
 */
export const trainDecisions = pgTable("train_decisions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  symbol: varchar("symbol", { length: 10 }).notNull(),
  date: varchar("date", { length: 10 }).notNull(),
  windowNumber: integer("window_number").notNull(), // 1, 2, or 3
  direction: varchar("direction", { length: 20 }).notNull(),
  reasoning: text("reasoning"),
  spotPriceAtDecision: doublePrecision("spot_price_at_decision"),
  outcomeDirection: varchar("outcome_direction", { length: 20 }),
  outcomePnl: doublePrecision("outcome_pnl"),
  wasCorrect: boolean("was_correct"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("train_decisions_user_idx").on(table.userId),
  index("train_decisions_date_idx").on(table.date),
]);

export const insertTrainDecisionSchema = createInsertSchema(trainDecisions).omit({
  id: true,
  createdAt: true,
});
export type TrainDecision = typeof trainDecisions.$inferSelect;
export type InsertTrainDecision = z.infer<typeof insertTrainDecisionSchema>;

// ==================== API KEYS ====================

// API keys for TWS Relay connections
export const apiKeys = pgTable('api_keys', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar('user_id').references(() => users.id, { onDelete: 'cascade' }).notNull(),
  key: text('key').notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at'),
}, (table) => [
  index("api_keys_user_idx").on(table.userId),
]);

// ==================== CODEACT AGENT MEMORY ====================

// Agent memory - file-like storage in database
export const agentMemory = pgTable('agent_memory', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),  // e.g., 'trading_rules', 'session_log'
  content: text('content').notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Agent CodeAct event stream - chronological log of everything
export const agentCodeActEvents = pgTable('agent_codeact_events', {
  id: serial('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
  type: text('type').notNull(),  // 'observation', 'reasoning', 'code_execution', 'proposal', 'approval', 'trade'
  content: text('content').notNull(),
  metadata: jsonb('metadata'),  // Additional structured data
}, (table) => [
  index("agent_codeact_events_session_idx").on(table.sessionId),
  index("agent_codeact_events_timestamp_idx").on(table.timestamp),
]);

// ==================== END CODEACT AGENT MEMORY ====================

// ==================== END TRAINING MODE ====================

// Option chain types
export type OptionData = {
  strike: number;
  type: "call" | "put";
  bid: number;
  ask: number;
  delta: number;
  openInterest: number;
  expiration: string;
  last?: number;               // Last trade price
  iv?: number;                 // Implied volatility
};

export type OptionChainData = {
  symbol: string;
  underlyingPrice: number;
  underlyingChange: number;
  options: OptionData[];
  // Convenience accessors for puts/calls
  puts?: OptionData[];
  calls?: OptionData[];
};

// Spread types
export type SpreadLeg = {
  strike: number;
  type: "call" | "put";
  action: "buy" | "sell";
  premium: number;
  delta: number;
  openInterest: number;
};

export type SpreadConfig = {
  symbol: string;
  strategy: "put_credit" | "call_credit";
  sellLeg: SpreadLeg;
  buyLeg: SpreadLeg;
  quantity: number;
  expiration: string;
};

// Validation types
export type ValidationResult = {
  passed: boolean;
  type: "margin" | "delta" | "symbol_limit" | "position_size";
  message: string;
  details?: any;
};

export type TradeValidation = {
  results: ValidationResult[];
  allowedContracts: number;
  maxRisk: number;
  marginRequired: number;
  deltaImpact: number;
};

// ==================== ACCOUNTING & RECONCILIATION ====================
// Comprehensive accounting system for tracking every cent and reconciling with IBKR

export const ledgerEntries = pgTable('ledger_entries', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar('user_id').references(() => users.id, { onDelete: 'cascade' }),

  // Timing
  timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
  effectiveDate: text('effective_date').notNull(), // YYYY-MM-DD

  // Classification
  entryType: varchar('entry_type', { length: 50 }).notNull(),
  // Types: 'premium_received', 'cost_to_close', 'commission',
  //        'assignment_credit', 'assignment_debit', 'deposit', 'withdrawal',
  //        'interest', 'dividend', 'fee', 'adjustment'

  // Amount (positive = money in, negative = money out)
  amount: decimal('amount', { precision: 15, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).default('USD'),

  // References
  tradeId: varchar('trade_id').references(() => paperTrades.id, { onDelete: 'set null' }),
  orderId: varchar('order_id').references(() => orders.id, { onDelete: 'set null' }),
  fillId: varchar('fill_id').references(() => fills.id, { onDelete: 'set null' }),

  // IBKR linking (for reconciliation)
  ibkrExecutionId: varchar('ibkr_execution_id', { length: 100 }),
  ibkrOrderId: varchar('ibkr_order_id', { length: 100 }),

  // Reconciliation status
  reconciled: boolean('reconciled').default(false),
  reconciledAt: timestamp('reconciled_at', { withTimezone: true }),

  // Metadata
  description: text('description'),
  metadata: jsonb('metadata'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('ledger_entries_user_date_idx').on(table.userId, table.effectiveDate),
  index('ledger_entries_trade_idx').on(table.tradeId),
  index('ledger_entries_ibkr_exec_idx').on(table.ibkrExecutionId),
]);

export const insertLedgerEntrySchema = createInsertSchema(ledgerEntries).omit({
  id: true,
  createdAt: true,
  timestamp: true,
});

export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type InsertLedgerEntry = z.infer<typeof insertLedgerEntrySchema>;

// Daily snapshots - End-of-day checkpoints for reconciliation
export const dailySnapshots = pgTable('daily_snapshots', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar('user_id').references(() => users.id, { onDelete: 'cascade' }),
  snapshotDate: text('snapshot_date').notNull(), // YYYY-MM-DD

  // Internal calculations (from ledger_entries)
  internalCash: decimal('internal_cash', { precision: 15, scale: 2 }),
  internalPositionsValue: decimal('internal_positions_value', { precision: 15, scale: 2 }),
  internalNav: decimal('internal_nav', { precision: 15, scale: 2 }),
  internalRealizedPnl: decimal('internal_realized_pnl', { precision: 15, scale: 2 }),
  internalUnrealizedPnl: decimal('internal_unrealized_pnl', { precision: 15, scale: 2 }),

  // IBKR reported values
  ibkrCash: decimal('ibkr_cash', { precision: 15, scale: 2 }),
  ibkrPositionsValue: decimal('ibkr_positions_value', { precision: 15, scale: 2 }),
  ibkrNav: decimal('ibkr_nav', { precision: 15, scale: 2 }),
  ibkrRealizedPnl: decimal('ibkr_realized_pnl', { precision: 15, scale: 2 }),
  ibkrUnrealizedPnl: decimal('ibkr_unrealized_pnl', { precision: 15, scale: 2 }),

  // Variance analysis
  cashVariance: decimal('cash_variance', { precision: 15, scale: 2 }),
  navVariance: decimal('nav_variance', { precision: 15, scale: 2 }),

  // Reconciliation
  reconciliationStatus: varchar('reconciliation_status', { length: 20 }).default('pending'),
  // Status: 'pending', 'auto_reconciled', 'manual_reconciled', 'discrepancy'
  reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
  reconciledBy: varchar('reconciled_by', { length: 100 }), // 'system' or user

  // Raw IBKR response for audit
  ibkrRawResponse: jsonb('ibkr_raw_response'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('daily_snapshots_user_date_unique').on(table.userId, table.snapshotDate),
]);

export const insertDailySnapshotSchema = createInsertSchema(dailySnapshots).omit({
  id: true,
  createdAt: true,
});

export type DailySnapshot = typeof dailySnapshots.$inferSelect;
export type InsertDailySnapshot = z.infer<typeof insertDailySnapshotSchema>;

// Reconciliation issues - Track discrepancies between internal and IBKR
export const reconciliationIssues = pgTable('reconciliation_issues', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar('user_id').references(() => users.id, { onDelete: 'cascade' }),
  snapshotId: varchar('snapshot_id').references(() => dailySnapshots.id, { onDelete: 'cascade' }),

  // Issue details
  issueType: varchar('issue_type', { length: 50 }).notNull(),
  // Types: 'cash_mismatch', 'nav_mismatch', 'missing_internal_trade',
  //        'missing_ibkr_trade', 'amount_mismatch', 'position_mismatch'

  severity: varchar('severity', { length: 20 }).default('medium'),
  // Severity: 'low' (<$10), 'medium' ($10-$100), 'high' (>$100)

  internalValue: decimal('internal_value', { precision: 15, scale: 2 }),
  ibkrValue: decimal('ibkr_value', { precision: 15, scale: 2 }),
  variance: decimal('variance', { precision: 15, scale: 2 }),

  // Resolution
  status: varchar('status', { length: 20 }).default('open'),
  // Status: 'open', 'investigating', 'resolved', 'accepted'

  resolutionType: varchar('resolution_type', { length: 50 }),
  // Types: 'timing_difference', 'rounding', 'data_correction',
  //        'ibkr_error', 'internal_error', 'accepted_variance'

  resolutionNotes: text('resolution_notes'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),

  // References
  relatedTradeId: varchar('related_trade_id').references(() => paperTrades.id, { onDelete: 'set null' }),
  relatedLedgerEntryId: varchar('related_ledger_entry_id').references(() => ledgerEntries.id, { onDelete: 'set null' }),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('reconciliation_issues_user_idx').on(table.userId),
  index('reconciliation_issues_snapshot_idx').on(table.snapshotId),
  index('reconciliation_issues_status_idx').on(table.status),
]);

export const insertReconciliationIssueSchema = createInsertSchema(reconciliationIssues).omit({
  id: true,
  createdAt: true,
});

export type ReconciliationIssue = typeof reconciliationIssues.$inferSelect;
export type InsertReconciliationIssue = z.infer<typeof insertReconciliationIssueSchema>;

// Attestation periods - Links verified periods to Solana on-chain proofs
export const attestationPeriods = pgTable('attestation_periods', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar('user_id').references(() => users.id, { onDelete: 'cascade' }),

  // Period covered
  periodStart: text('period_start').notNull(), // YYYY-MM-DD
  periodEnd: text('period_end').notNull(), // YYYY-MM-DD
  periodLabel: varchar('period_label', { length: 100 }), // e.g., "Week of Jan 20-26, 2026"

  // Prerequisites
  allDaysReconciled: boolean('all_days_reconciled').notNull(),
  reconciliationIssuesCount: integer('reconciliation_issues_count').default(0),

  // Performance summary
  startingNav: decimal('starting_nav', { precision: 15, scale: 2 }),
  endingNav: decimal('ending_nav', { precision: 15, scale: 2 }),
  totalPnl: decimal('total_pnl', { precision: 15, scale: 2 }),
  returnPercent: decimal('return_percent', { precision: 8, scale: 4 }),
  tradeCount: integer('trade_count'),
  winCount: integer('win_count'),
  lossCount: integer('loss_count'),

  // Hashes for verification
  tradesHash: varchar('trades_hash', { length: 64 }), // SHA256 of all trade data
  snapshotsHash: varchar('snapshots_hash', { length: 64 }), // SHA256 of daily snapshots
  masterHash: varchar('master_hash', { length: 64 }), // SHA256(trades_hash + snapshots_hash)

  // Solana attestation
  solanaSignature: varchar('solana_signature', { length: 100 }),
  solanaSlot: bigint('solana_slot', { mode: 'number' }),
  solanaPda: varchar('solana_pda', { length: 100 }), // Program Derived Address
  attestedAt: timestamp('attested_at', { withTimezone: true }),

  // Status
  status: varchar('status', { length: 20 }).default('draft'),
  // Status: 'draft', 'ready', 'attested', 'superseded'

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  uniqueIndex('attestation_periods_user_period_unique').on(table.userId, table.periodStart, table.periodEnd),
  index('attestation_periods_user_idx').on(table.userId),
  index('attestation_periods_status_idx').on(table.status),
]);

export const insertAttestationPeriodSchema = createInsertSchema(attestationPeriods).omit({
  id: true,
  createdAt: true,
  attestedAt: true,
});

export type AttestationPeriod = typeof attestationPeriods.$inferSelect;
export type InsertAttestationPeriod = z.infer<typeof insertAttestationPeriodSchema>;

// ==================== END ACCOUNTING & RECONCILIATION ====================

// ==================== LATEST PRICES (WebSocket Price Persistence) ====================
// Stores the most recent prices from WebSocket streaming for recovery after restarts
// Ensures SPY/VIX prices survive server restarts and are available even when WebSocket is disconnected

export const latestPrices = pgTable('latest_prices', {
  symbol: text('symbol').primaryKey(),
  conid: integer('conid'),
  price: decimal('price', { precision: 12, scale: 4 }).notNull(),
  bid: decimal('bid', { precision: 12, scale: 4 }),
  ask: decimal('ask', { precision: 12, scale: 4 }),
  source: text('source').notNull().default('websocket'), // 'websocket' | 'manual' | 'historical'
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => [
  index('latest_prices_conid_idx').on(table.conid),
]);

export const insertLatestPriceSchema = createInsertSchema(latestPrices);

export type LatestPrice = typeof latestPrices.$inferSelect;
export type InsertLatestPrice = z.infer<typeof insertLatestPriceSchema>;

// ==================== END LATEST PRICES ====================

// Account info type
export type AccountInfo = {
  accountNumber: string;
  buyingPower: number;
  portfolioValue: number;
  netDelta: number;
  dayPnL: number;
  marginUsed: number;
  // New enhanced fields
  totalCash: number;
  settledCash: number;
  grossPositionValue: number;
  maintenanceMargin: number;
  cushion: number;       // % buffer before margin call (excessLiquidity / maintenanceMargin)
  leverage: number;      // grossPositionValue / netLiquidation
  excessLiquidity: number;
  // Additional fields for IBKR compatibility
  netLiquidation?: number;  // Net liquidation value (same as portfolioValue)
  accountId?: string;       // IBKR account ID
  netValue?: number;        // Net value alias
  marginLoan?: number;      // Margin loan amount
};
