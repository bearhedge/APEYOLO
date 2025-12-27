CREATE TABLE "agent_ticks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tick_time" timestamp NOT NULL,
	"market_context" jsonb,
	"decision" text NOT NULL,
	"reasoning" text,
	"model_used" text,
	"proposal_id" varchar,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "continuous_job_status" (
	"id" text PRIMARY KEY NOT NULL,
	"is_running" boolean DEFAULT false,
	"last_capture_at" timestamp,
	"last_capture_result" text,
	"last_error" text,
	"capture_count_today" integer DEFAULT 0,
	"complete_count" integer DEFAULT 0,
	"partial_count" integer DEFAULT 0,
	"snapshot_only_count" integer DEFAULT 0,
	"ws_connected" boolean DEFAULT false,
	"market_day" text,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content" text NOT NULL,
	"source" text NOT NULL,
	"category" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mandate_violations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"mandate_id" varchar NOT NULL,
	"violation_type" text NOT NULL,
	"attempted_value" text,
	"limit_value" text,
	"action_taken" text NOT NULL,
	"trade_details" jsonb,
	"on_chain_hash" text,
	"solana_signature" text,
	"solana_slot" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "option_bars" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"strike" numeric(10, 2) NOT NULL,
	"expiry" text NOT NULL,
	"option_type" text NOT NULL,
	"interval_start" timestamp NOT NULL,
	"open" numeric(10, 4),
	"high" numeric(10, 4),
	"low" numeric(10, 4),
	"close" numeric(10, 4),
	"bid_close" numeric(10, 4),
	"ask_close" numeric(10, 4),
	"delta" numeric(8, 6),
	"gamma" numeric(8, 6),
	"theta" numeric(8, 6),
	"vega" numeric(8, 6),
	"iv" numeric(8, 6),
	"open_interest" integer,
	"data_quality" text NOT NULL,
	"tick_count" integer DEFAULT 0,
	"underlying_price" numeric(10, 4),
	"vix" numeric(8, 4),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "patterns" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"conditions" jsonb,
	"recommendation" text,
	"trades" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"total_pnl" numeric(12, 2) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_mandates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"allowed_symbols" jsonb NOT NULL,
	"strategy_type" text NOT NULL,
	"min_delta" numeric(4, 2),
	"max_delta" numeric(4, 2),
	"max_daily_loss_percent" numeric(5, 4),
	"no_overnight_positions" boolean DEFAULT true NOT NULL,
	"exit_deadline" text,
	"trading_window_start" text,
	"trading_window_end" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_locked" boolean DEFAULT true NOT NULL,
	"on_chain_hash" text,
	"solana_signature" text,
	"solana_slot" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paper_trades" ADD COLUMN "spot_price_at_close" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "paper_trades" ADD COLUMN "validation_status" text DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "agent_reasoning" text;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "critic_approval" boolean;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "pattern_id" varchar;--> statement-breakpoint
ALTER TABLE "mandate_violations" ADD CONSTRAINT "mandate_violations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandate_violations" ADD CONSTRAINT "mandate_violations_mandate_id_trading_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."trading_mandates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_mandates" ADD CONSTRAINT "trading_mandates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_ticks_time_idx" ON "agent_ticks" USING btree ("tick_time");--> statement-breakpoint
CREATE INDEX "agent_ticks_decision_idx" ON "agent_ticks" USING btree ("decision");--> statement-breakpoint
CREATE INDEX "lessons_active_idx" ON "lessons" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "lessons_source_idx" ON "lessons" USING btree ("source");--> statement-breakpoint
CREATE INDEX "mandate_violations_user_id_idx" ON "mandate_violations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mandate_violations_mandate_id_idx" ON "mandate_violations" USING btree ("mandate_id");--> statement-breakpoint
CREATE INDEX "mandate_violations_created_at_idx" ON "mandate_violations" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_option_bars_unique" ON "option_bars" USING btree ("symbol","strike","expiry","option_type","interval_start");--> statement-breakpoint
CREATE INDEX "idx_option_bars_symbol_time" ON "option_bars" USING btree ("symbol","interval_start");--> statement-breakpoint
CREATE INDEX "patterns_active_idx" ON "patterns" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "trading_mandates_user_id_idx" ON "trading_mandates" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trading_mandates_active_idx" ON "trading_mandates" USING btree ("user_id","is_active");