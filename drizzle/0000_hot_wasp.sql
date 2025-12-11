CREATE TABLE "audit_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"details" text NOT NULL,
	"user_id" text,
	"status" text NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cash_flows" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"description" text,
	"user_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "economic_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"event_name" text NOT NULL,
	"event_date" text NOT NULL,
	"event_time" text,
	"release_id" integer,
	"impact_level" text DEFAULT 'high' NOT NULL,
	"description" text,
	"source" text DEFAULT 'fred' NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fills" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"order_id" varchar,
	"trade_id" varchar,
	"fill_time" timestamp NOT NULL,
	"fill_price" double precision NOT NULL,
	"fill_quantity" integer NOT NULL,
	"execution_id" text,
	"commission" double precision DEFAULT 0,
	"fees" double precision DEFAULT 0,
	"delta_at_fill" double precision,
	"gamma_at_fill" double precision,
	"theta_at_fill" double precision,
	"vega_at_fill" double precision,
	"iv_at_fill" double precision,
	"underlying_price_at_fill" double precision,
	"vix_at_fill" double precision,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "greeks_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" varchar,
	"snapshot_time" timestamp NOT NULL,
	"delta" double precision,
	"gamma" double precision,
	"theta" double precision,
	"vega" double precision,
	"iv" double precision,
	"option_price" double precision,
	"underlying_price" double precision,
	"vix" double precision,
	"dte" double precision,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ibkr_credentials" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"client_id" text NOT NULL,
	"client_key_id" text NOT NULL,
	"private_key_encrypted" text NOT NULL,
	"credential" text NOT NULL,
	"account_id" text,
	"allowed_ip" text,
	"environment" text DEFAULT 'paper' NOT NULL,
	"status" text DEFAULT 'inactive' NOT NULL,
	"last_connected_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" text NOT NULL,
	"status" text NOT NULL,
	"triggered_by" text DEFAULT 'scheduler' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"duration_ms" integer,
	"result" jsonb,
	"error" text,
	"market_day" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"schedule" text NOT NULL,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb,
	"last_run_at" timestamp,
	"last_run_status" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_data" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"timestamp" timestamp NOT NULL,
	"open" numeric(12, 4) NOT NULL,
	"high" numeric(12, 4) NOT NULL,
	"low" numeric(12, 4) NOT NULL,
	"close" numeric(12, 4) NOT NULL,
	"volume" bigint,
	"interval" text NOT NULL,
	"source" text DEFAULT 'yahoo' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nav_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" text NOT NULL,
	"snapshot_type" text DEFAULT 'closing' NOT NULL,
	"nav" numeric(12, 2) NOT NULL,
	"user_id" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "option_chain_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_run_id" varchar,
	"symbol" varchar(10) NOT NULL,
	"captured_at" timestamp DEFAULT now() NOT NULL,
	"market_day" text NOT NULL,
	"underlying_price" numeric(10, 2),
	"vix" numeric(6, 2),
	"expiration" text,
	"chain_data" jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"ibkr_order_id" varchar(50),
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"quantity" integer NOT NULL,
	"order_type" text NOT NULL,
	"limit_price" numeric(10, 2),
	"status" text NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"filled_at" timestamp,
	"cancelled_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "paper_trades" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" varchar(50) NOT NULL,
	"symbol" text NOT NULL,
	"strategy" text NOT NULL,
	"bias" text NOT NULL,
	"expiration" timestamp NOT NULL,
	"expiration_label" text NOT NULL,
	"contracts" integer NOT NULL,
	"leg1_type" text NOT NULL,
	"leg1_strike" numeric(10, 2) NOT NULL,
	"leg1_delta" numeric(10, 4) NOT NULL,
	"leg1_premium" numeric(10, 4) NOT NULL,
	"leg2_type" text,
	"leg2_strike" numeric(10, 2),
	"leg2_delta" numeric(10, 4),
	"leg2_premium" numeric(10, 4),
	"entry_premium_total" numeric(10, 2) NOT NULL,
	"margin_required" numeric(10, 2) NOT NULL,
	"max_loss" numeric(10, 2) NOT NULL,
	"stop_loss_price" numeric(10, 4) NOT NULL,
	"stop_loss_multiplier" numeric(4, 1) NOT NULL,
	"time_stop_et" text NOT NULL,
	"entry_vix" numeric(10, 2),
	"entry_vix_regime" text,
	"entry_spy_price" numeric(10, 2),
	"risk_profile" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"exit_price" numeric(10, 4),
	"exit_reason" text,
	"realized_pnl" numeric(10, 2),
	"ibkr_order_ids" jsonb,
	"user_id" varchar,
	"full_proposal" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"symbol" text NOT NULL,
	"strategy" text NOT NULL,
	"sell_strike" numeric(10, 2) NOT NULL,
	"buy_strike" numeric(10, 2) NOT NULL,
	"expiration" timestamp NOT NULL,
	"quantity" integer NOT NULL,
	"open_credit" numeric(10, 2) NOT NULL,
	"current_value" numeric(10, 2) NOT NULL,
	"delta" numeric(10, 4) NOT NULL,
	"margin_required" numeric(10, 2) NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"status" text DEFAULT 'open' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_rules" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "risk_rules_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"symbol" text NOT NULL,
	"strategy" text NOT NULL,
	"sell_strike" numeric(10, 2) NOT NULL,
	"buy_strike" numeric(10, 2) NOT NULL,
	"expiration" timestamp NOT NULL,
	"quantity" integer NOT NULL,
	"credit" numeric(10, 2) NOT NULL,
	"status" text NOT NULL,
	"submitted_at" timestamp DEFAULT now() NOT NULL,
	"entry_fill_price" double precision,
	"entry_commission" double precision,
	"entry_delta" double precision,
	"entry_gamma" double precision,
	"entry_theta" double precision,
	"entry_vega" double precision,
	"entry_iv" double precision,
	"entry_underlying_price" double precision,
	"entry_vix" double precision,
	"exit_fill_price" double precision,
	"exit_commission" double precision,
	"exit_delta" double precision,
	"exit_gamma" double precision,
	"exit_theta" double precision,
	"exit_vega" double precision,
	"exit_iv" double precision,
	"exit_underlying_price" double precision,
	"exit_vix" double precision,
	"exit_reason" text,
	"closed_at" timestamp,
	"gross_pnl" double precision,
	"total_commissions" double precision,
	"total_fees" double precision,
	"net_pnl" double precision,
	"risk_regime" text,
	"target_delta" double precision,
	"actual_delta" double precision,
	"contract_count" integer
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"picture" text,
	"google_id" text,
	"username" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "cash_flows" ADD CONSTRAINT "cash_flows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fills" ADD CONSTRAINT "fills_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "greeks_snapshots" ADD CONSTRAINT "greeks_snapshots_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ibkr_credentials" ADD CONSTRAINT "ibkr_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nav_snapshots" ADD CONSTRAINT "nav_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_chain_snapshots" ADD CONSTRAINT "option_chain_snapshots_job_run_id_job_runs_id_fk" FOREIGN KEY ("job_run_id") REFERENCES "public"."job_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_flows_date_idx" ON "cash_flows" USING btree ("date");--> statement-breakpoint
CREATE INDEX "cash_flows_type_idx" ON "cash_flows" USING btree ("type");--> statement-breakpoint
CREATE INDEX "economic_events_date_idx" ON "economic_events" USING btree ("event_date");--> statement-breakpoint
CREATE INDEX "economic_events_type_date_idx" ON "economic_events" USING btree ("event_type","event_date");--> statement-breakpoint
CREATE INDEX "fills_order_id_idx" ON "fills" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "fills_trade_id_idx" ON "fills" USING btree ("trade_id");--> statement-breakpoint
CREATE INDEX "fills_fill_time_idx" ON "fills" USING btree ("fill_time");--> statement-breakpoint
CREATE INDEX "greeks_snapshots_trade_id_idx" ON "greeks_snapshots" USING btree ("trade_id");--> statement-breakpoint
CREATE INDEX "greeks_snapshots_time_idx" ON "greeks_snapshots" USING btree ("snapshot_time");--> statement-breakpoint
CREATE INDEX "job_runs_job_id_idx" ON "job_runs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_runs_started_at_idx" ON "job_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "job_runs_market_day_idx" ON "job_runs" USING btree ("job_id","market_day");--> statement-breakpoint
CREATE INDEX "market_data_symbol_timestamp_idx" ON "market_data" USING btree ("symbol","timestamp");--> statement-breakpoint
CREATE INDEX "market_data_symbol_interval_timestamp_idx" ON "market_data" USING btree ("symbol","interval","timestamp");--> statement-breakpoint
CREATE INDEX "nav_snapshots_date_idx" ON "nav_snapshots" USING btree ("date");--> statement-breakpoint
CREATE INDEX "nav_snapshots_date_type_idx" ON "nav_snapshots" USING btree ("date","snapshot_type");--> statement-breakpoint
CREATE INDEX "option_chain_snapshots_symbol_idx" ON "option_chain_snapshots" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "option_chain_snapshots_market_day_idx" ON "option_chain_snapshots" USING btree ("symbol","market_day");--> statement-breakpoint
CREATE INDEX "option_chain_snapshots_captured_at_idx" ON "option_chain_snapshots" USING btree ("captured_at");