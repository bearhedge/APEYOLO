import { sql } from "drizzle-orm";
import { pgTable, text, varchar, decimal, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
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
};
