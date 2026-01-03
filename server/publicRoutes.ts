// server/publicRoutes.ts
import { Router, Request, Response } from 'express';
import { db } from './db';
import { paperTrades, navSnapshots, optionBars } from '@shared/schema';
import { desc, eq, and, sql, gte } from 'drizzle-orm';

const router = Router();

/**
 * GET /api/public/track-record
 * Returns daily P&L summary for bearhedge.com
 */
router.get('/track-record', async (_req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not available' });
    }

    // Get daily P&L aggregated from closed/expired trades
    const dailyPnl = await db
      .select({
        date: sql<string>`DATE(${paperTrades.closedAt})`.as('date'),
        pnl: sql<number>`SUM(CAST(${paperTrades.realizedPnl} AS DECIMAL))`.as('pnl'),
        trades: sql<number>`COUNT(*)`.as('trades'),
        contracts: sql<number>`SUM(${paperTrades.contracts})`.as('contracts'),
      })
      .from(paperTrades)
      .where(
        and(
          sql`${paperTrades.status} IN ('closed', 'expired')`,
          sql`${paperTrades.closedAt} IS NOT NULL`
        )
      )
      .groupBy(sql`DATE(${paperTrades.closedAt})`)
      .orderBy(desc(sql`DATE(${paperTrades.closedAt})`))
      .limit(90); // Last 90 days

    // Get cumulative stats
    const [totals] = await db
      .select({
        totalPnl: sql<number>`SUM(CAST(${paperTrades.realizedPnl} AS DECIMAL))`.as('total_pnl'),
        totalTrades: sql<number>`COUNT(*)`.as('total_trades'),
        winCount: sql<number>`SUM(CASE WHEN CAST(${paperTrades.realizedPnl} AS DECIMAL) > 0 THEN 1 ELSE 0 END)`.as('win_count'),
      })
      .from(paperTrades)
      .where(sql`${paperTrades.status} IN ('closed', 'expired')`);

    const winRate = totals?.totalTrades > 0
      ? (totals.winCount / totals.totalTrades * 100).toFixed(1)
      : '0.0';

    res.json({
      ok: true,
      daily: dailyPnl,
      totals: {
        totalPnl: totals?.totalPnl || 0,
        totalTrades: totals?.totalTrades || 0,
        winRate: parseFloat(winRate),
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[PublicAPI] track-record error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/public/trades
 * Returns recent trades for bearhedge.com
 */
router.get('/trades', async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not available' });
    }

    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    const trades = await db
      .select({
        id: paperTrades.id,
        symbol: paperTrades.symbol,
        strategy: paperTrades.strategy,
        bias: paperTrades.bias,
        contracts: paperTrades.contracts,
        entryPremiumTotal: paperTrades.entryPremiumTotal,
        realizedPnl: paperTrades.realizedPnl,
        status: paperTrades.status,
        expiration: paperTrades.expiration,
        createdAt: paperTrades.createdAt,
        closedAt: paperTrades.closedAt,
        leg1Strike: paperTrades.leg1Strike,
        leg2Strike: paperTrades.leg2Strike,
      })
      .from(paperTrades)
      .orderBy(desc(paperTrades.createdAt))
      .limit(limit);

    res.json({
      ok: true,
      trades,
      count: trades.length,
    });
  } catch (error: any) {
    console.error('[PublicAPI] trades error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/public/stats
 * Returns aggregate stats for bearhedge.com projects section
 */
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not available' });
    }

    const [stats] = await db
      .select({
        totalTrades: sql<number>`COUNT(*)`.as('total_trades'),
        totalTurnover: sql<number>`SUM(CAST(${paperTrades.entryPremiumTotal} AS DECIMAL))`.as('total_turnover'),
        totalPnl: sql<number>`SUM(CAST(${paperTrades.realizedPnl} AS DECIMAL))`.as('total_pnl'),
      })
      .from(paperTrades);

    res.json({
      ok: true,
      users: 1, // Single user for now
      totalTrades: stats?.totalTrades || 0,
      totalTurnover: stats?.totalTurnover || 0,
      totalPnl: stats?.totalPnl || 0,
    });
  } catch (error: any) {
    console.error('[PublicAPI] stats error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/public/option-bars/:symbol
 * Returns recent option bar data for charts
 */
router.get('/option-bars/:symbol', async (req: Request, res: Response) => {
  try {
    if (!db) {
      return res.status(503).json({ error: 'Database not available' });
    }

    const symbol = req.params.symbol.toUpperCase();
    const hours = Math.min(parseInt(req.query.hours as string) || 6, 24);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const bars = await db
      .select()
      .from(optionBars)
      .where(
        and(
          eq(optionBars.symbol, symbol),
          gte(optionBars.intervalStart, since)
        )
      )
      .orderBy(desc(optionBars.intervalStart))
      .limit(500);

    res.json({
      ok: true,
      symbol,
      bars,
      count: bars.length,
    });
  } catch (error: any) {
    console.error('[PublicAPI] option-bars error:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;
