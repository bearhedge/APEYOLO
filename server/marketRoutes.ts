/**
 * Market Data API Routes
 *
 * Endpoints for real-time and historical market data.
 * Data from Yahoo Finance, structured for UI display and AI consumption.
 */

import { Router } from 'express';
import {
  fetchQuote,
  fetchHistoricalData,
  fetchVIXData,
  fetchMarketSnapshot,
  type TimeRange,
  type BarInterval
} from './services/yahooFinanceService';

const router = Router();

/**
 * GET /api/market/quote/:symbol
 * Fetch current quote for a symbol
 */
router.get('/quote/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;

    // Map common symbols to Yahoo Finance format
    const yahooSymbol = mapSymbol(symbol);
    const quote = await fetchQuote(yahooSymbol);

    res.json(quote);
  } catch (error: any) {
    console.error('[Market] Quote error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch quote' });
  }
});

/**
 * GET /api/market/history/:symbol
 * Fetch historical OHLC data
 * Query params:
 *   - range: 1D | 5D | 1M | 3M | 6M | 1Y | MAX (default: 1D) - lookback period
 *   - interval: 1m | 5m | 15m | 30m | 1h | 1d (optional) - candlestick bar size
 */
router.get('/history/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const range = (req.query.range as TimeRange) || '1D';
    const interval = req.query.interval as BarInterval | undefined;

    // Validate range
    const validRanges: TimeRange[] = ['1D', '5D', '1M', '3M', '6M', '1Y', 'MAX'];
    if (!validRanges.includes(range)) {
      return res.status(400).json({ error: `Invalid range. Must be one of: ${validRanges.join(', ')}` });
    }

    // Validate interval if provided
    if (interval) {
      const validIntervals: BarInterval[] = ['1m', '5m', '15m', '30m', '1h', '1d'];
      if (!validIntervals.includes(interval)) {
        return res.status(400).json({ error: `Invalid interval. Must be one of: ${validIntervals.join(', ')}` });
      }
    }

    const yahooSymbol = mapSymbol(symbol);
    const history = await fetchHistoricalData(yahooSymbol, range, interval);

    res.json({
      symbol,
      range,
      interval: interval || 'default',
      count: history.length,
      data: history
    });
  } catch (error: any) {
    console.error('[Market] History error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch history' });
  }
});

/**
 * GET /api/market/vix
 * VIX-specific endpoint with trading context
 */
router.get('/vix', async (_req, res) => {
  try {
    const vixData = await fetchVIXData();
    res.json(vixData);
  } catch (error: any) {
    console.error('[Market] VIX error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch VIX data' });
  }
});

/**
 * GET /api/market/vix/history
 * VIX historical data with chart-ready format
 * Query params:
 *   - range: 1D | 5D | 1M | 3M | 6M | 1Y | MAX (default: 1D)
 *   - interval: 1m | 5m | 15m | 30m | 1h | 1d (optional)
 */
router.get('/vix/history', async (req, res) => {
  try {
    const range = (req.query.range as TimeRange) || '1D';
    const interval = req.query.interval as BarInterval | undefined;

    const validRanges: TimeRange[] = ['1D', '5D', '1M', '3M', '6M', '1Y', 'MAX'];
    if (!validRanges.includes(range)) {
      return res.status(400).json({ error: `Invalid range. Must be one of: ${validRanges.join(', ')}` });
    }

    if (interval) {
      const validIntervals: BarInterval[] = ['1m', '5m', '15m', '30m', '1h', '1d'];
      if (!validIntervals.includes(interval)) {
        return res.status(400).json({ error: `Invalid interval. Must be one of: ${validIntervals.join(', ')}` });
      }
    }

    const history = await fetchHistoricalData('^VIX', range, interval);

    res.json({
      symbol: 'VIX',
      range,
      interval: interval || 'default',
      count: history.length,
      data: history
    });
  } catch (error: any) {
    console.error('[Market] VIX history error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch VIX history' });
  }
});

/**
 * GET /api/market/snapshot
 * Combined market data for AI consumption
 * Returns VIX + SPY data in a single call
 */
router.get('/snapshot', async (_req, res) => {
  try {
    const snapshot = await fetchMarketSnapshot();
    res.json(snapshot);
  } catch (error: any) {
    console.error('[Market] Snapshot error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch market snapshot' });
  }
});

/**
 * Map common symbol names to Yahoo Finance format
 */
function mapSymbol(symbol: string): string {
  const symbolMap: Record<string, string> = {
    'VIX': '^VIX',
    'SPX': '^SPX',
    'DJI': '^DJI',
    'IXIC': '^IXIC',
    'SPY': 'SPY',
    'QQQ': 'QQQ'
  };

  return symbolMap[symbol.toUpperCase()] || symbol;
}

export default router;
