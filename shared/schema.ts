import { sql } from "drizzle-orm";
import { pgTable, text, varchar, decimal, integer, timestamp, boolean, jsonb, bigint, index } from "drizzle-orm/pg-core";
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
  symbol: text("symbol").notNull(),
  strategy: text("strategy").notNull(),
  sellStrike: decimal("sell_strike", { precision: 10, scale: 2 }).notNull(),
  buyStrike: decimal("buy_strike", { precision: 10, scale: 2 }).notNull(),
  expiration: timestamp("expiration").notNull(),
  quantity: integer("quantity").notNull(),
  credit: decimal("credit", { precision: 10, scale: 2 }).notNull(),
  status: text("status").notNull(), // "pending" | "filled" | "rejected"
  submittedAt: timestamp("submitted_at").notNull().defaultNow(),
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

  // IBKR integration
  ibkrOrderIds: jsonb("ibkr_order_ids"),  // Array of order IDs from IBKR

  // Audit
  userId: varchar("user_id").references(() => users.id),
  fullProposal: jsonb("full_proposal"),   // Complete TradeProposal JSON for audit

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

// Option chain types
export type OptionData = {
  strike: number;
  type: "call" | "put";
  bid: number;
  ask: number;
  delta: number;
  openInterest: number;
  expiration: string;
};

export type OptionChainData = {
  symbol: string;
  underlyingPrice: number;
  underlyingChange: number;
  options: OptionData[];
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
};
