-- Add commission tracking fields to paper_trades table
ALTER TABLE "paper_trades" ADD COLUMN "entry_commission" double precision;
ALTER TABLE "paper_trades" ADD COLUMN "exit_commission" double precision;
ALTER TABLE "paper_trades" ADD COLUMN "total_commissions" double precision;
ALTER TABLE "paper_trades" ADD COLUMN "gross_pnl" double precision;
ALTER TABLE "paper_trades" ADD COLUMN "net_pnl" double precision;
