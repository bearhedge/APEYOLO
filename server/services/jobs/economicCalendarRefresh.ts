/**
 * Economic Calendar Refresh Job
 *
 * Fetches upcoming economic events from FRED API and stores them in the database.
 * Runs weekly (Sunday night) to keep the calendar up to date.
 */

import { registerJobHandler, type JobResult, type JobHandler } from '../jobExecutor';
import {
  refreshEconomicCalendar,
  isFREDConfigured,
  FRED_RELEASES,
} from '../fredApi';

// ============================================
// Types
// ============================================

interface RefreshResult {
  cleared: number;
  inserted: number;
  total: number;
  releases: string[];
}

// ============================================
// Job Handler Implementation
// ============================================

/**
 * Economic Calendar Refresh Job Handler
 *
 * Unlike market-close jobs, this job:
 * - Runs weekly (Sunday night) instead of daily
 * - Does NOT check market status (can run anytime)
 * - Fetches data from FRED API instead of IBKR
 */
export const economicCalendarRefreshHandler: JobHandler = {
  id: 'economic-calendar-refresh',
  name: 'Economic Calendar Refresh',
  description: 'Refresh macroeconomic event calendar from FRED API',

  async execute(): Promise<JobResult> {
    console.log('[EconomicCalendarRefresh] Starting calendar refresh...');

    // 1. Check if FRED API is configured
    if (!isFREDConfigured()) {
      console.log('[EconomicCalendarRefresh] FRED API key not configured');
      return {
        success: false,
        skipped: true,
        reason: 'FRED_API_KEY environment variable not set',
      };
    }

    try {
      // 2. Refresh the economic calendar (90 days ahead)
      const result = await refreshEconomicCalendar(90);

      console.log(
        `[EconomicCalendarRefresh] Refresh complete: ` +
        `cleared=${result.cleared}, inserted=${result.inserted}, total=${result.total}`
      );

      // 3. Return success with details
      return {
        success: true,
        data: {
          cleared: result.cleared,
          inserted: result.inserted,
          total: result.total,
          releases: Object.keys(FRED_RELEASES),
        } as RefreshResult,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[EconomicCalendarRefresh] Error:', errorMessage);

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
 * Initialize and register the economic calendar refresh job handler
 */
export function initializeEconomicCalendarRefreshJob(): void {
  console.log('[EconomicCalendarRefresh] Initializing job handler...');
  registerJobHandler(economicCalendarRefreshHandler);
}
