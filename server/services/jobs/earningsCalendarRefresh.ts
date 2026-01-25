/**
 * Earnings Calendar Refresh Job
 *
 * Fetches upcoming earnings events from Alpha Vantage API and stores them in the database.
 * Runs weekly (Sunday night) to keep the calendar up to date.
 */

import { registerJobHandler, type JobResult, type JobHandler } from '../jobExecutor';
import {
  refreshEarningsCalendar,
  isAlphaVantageConfigured,
} from '../earningsCalendar';

// ============================================
// Types
// ============================================

interface RefreshResult {
  cleared: number;
  inserted: number;
  total: number;
  symbols: string[];
}

// ============================================
// Job Handler Implementation
// ============================================

/**
 * Earnings Calendar Refresh Job Handler
 *
 * Unlike market-close jobs, this job:
 * - Runs weekly (Sunday night) instead of daily
 * - Does NOT check market status (can run anytime)
 * - Fetches data from Alpha Vantage API instead of IBKR
 */
export const earningsCalendarRefreshHandler: JobHandler = {
  id: 'earnings-calendar-refresh',
  name: 'Earnings Calendar Refresh',
  description: 'Refresh earnings calendar from Alpha Vantage API',

  async execute(): Promise<JobResult> {
    console.log('[EarningsCalendarRefresh] Starting calendar refresh...');

    // 1. Check if Alpha Vantage API is configured
    if (!isAlphaVantageConfigured()) {
      console.log('[EarningsCalendarRefresh] Alpha Vantage API key not configured');
      return {
        success: false,
        skipped: true,
        reason: 'ALPHA_VANTAGE_API_KEY environment variable not set',
      };
    }

    try {
      // 2. Refresh the earnings calendar
      const result = await refreshEarningsCalendar();

      console.log(
        `[EarningsCalendarRefresh] Refresh complete: ` +
        `cleared=${result.cleared}, inserted=${result.inserted}, total=${result.total}`
      );

      // 3. Return success with details
      return {
        success: true,
        data: {
          cleared: result.cleared,
          inserted: result.inserted,
          total: result.total,
          symbols: result.symbols,
        } as RefreshResult,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[EarningsCalendarRefresh] Error:', errorMessage);

      return {
        success: false,
        error: errorMessage,
      };
    }
  },
};

// ============================================
// Registration
// ============================================

/**
 * Initialize and register the earnings calendar refresh job handler
 */
export function initializeEarningsCalendarRefreshJob(): void {
  console.log('[EarningsCalendarRefresh] Initializing job handler...');
  registerJobHandler(earningsCalendarRefreshHandler);
}
