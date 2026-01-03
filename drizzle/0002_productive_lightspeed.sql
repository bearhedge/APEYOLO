CREATE TABLE "direction_predictions" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engine_run_id" varchar(36),
	"indicator_signal" text,
	"indicator_confidence" double precision,
	"indicator_reasoning" jsonb,
	"ai_suggestion" text,
	"ai_confidence" double precision,
	"user_choice" text NOT NULL,
	"agreed_with_ai" boolean,
	"agreed_with_indicators" boolean,
	"was_override" boolean,
	"override_was_correct" boolean,
	"pnl" double precision,
	"was_correct" boolean,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engine_runs" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(36),
	"symbol" text NOT NULL,
	"direction" text NOT NULL,
	"expiration_mode" text,
	"original_put_strike" double precision,
	"original_call_strike" double precision,
	"original_put_delta" double precision,
	"original_call_delta" double precision,
	"final_put_strike" double precision,
	"final_call_strike" double precision,
	"adjustment_count" integer DEFAULT 0,
	"underlying_price" double precision,
	"vix" double precision,
	"indicators" jsonb,
	"engine_output" jsonb,
	"trade_id" varchar(36),
	"realized_pnl" double precision,
	"exit_reason" text,
	"was_winner" boolean,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "indicator_snapshots" (
	"id" varchar(36) PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"price" double precision NOT NULL,
	"open" double precision,
	"high" double precision,
	"low" double precision,
	"volume" double precision,
	"sma_20" double precision,
	"sma_50" double precision,
	"ema_9" double precision,
	"ema_21" double precision,
	"rsi_14" double precision,
	"macd" double precision,
	"macd_signal" double precision,
	"macd_histogram" double precision,
	"atr_14" double precision,
	"bollinger_upper" double precision,
	"bollinger_lower" double precision,
	"vix" double precision,
	"trend_direction" text,
	"momentum_signal" text,
	"volatility_regime" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ibkr_credentials" ADD COLUMN "access_token_encrypted" text;--> statement-breakpoint
ALTER TABLE "ibkr_credentials" ADD COLUMN "access_token_expiry_ms" bigint;--> statement-breakpoint
ALTER TABLE "ibkr_credentials" ADD COLUMN "sso_token_encrypted" text;--> statement-breakpoint
ALTER TABLE "ibkr_credentials" ADD COLUMN "sso_session_id" text;--> statement-breakpoint
ALTER TABLE "ibkr_credentials" ADD COLUMN "sso_token_expiry_ms" bigint;--> statement-breakpoint
ALTER TABLE "ibkr_credentials" ADD COLUMN "cookie_jar_json" text;--> statement-breakpoint
ALTER TABLE "direction_predictions" ADD CONSTRAINT "direction_predictions_engine_run_id_engine_runs_id_fk" FOREIGN KEY ("engine_run_id") REFERENCES "public"."engine_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engine_runs" ADD CONSTRAINT "engine_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engine_runs" ADD CONSTRAINT "engine_runs_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "direction_predictions_engine_run_idx" ON "direction_predictions" USING btree ("engine_run_id");--> statement-breakpoint
CREATE INDEX "direction_predictions_created_idx" ON "direction_predictions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "engine_runs_user_id_idx" ON "engine_runs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "engine_runs_created_at_idx" ON "engine_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "indicator_snapshots_symbol_idx" ON "indicator_snapshots" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "indicator_snapshots_created_idx" ON "indicator_snapshots" USING btree ("created_at");