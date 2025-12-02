/**
 * Market Hours Utility
 *
 * Determines current US market status based on Eastern Time.
 * Used for chart indicators and data freshness indicators.
 */

export type MarketStatus = 'pre-market' | 'open' | 'after-hours' | 'closed';

export interface MarketStatusInfo {
  status: MarketStatus;
  nextChange: string;
  isExtendedHours: boolean;
}

/**
 * Get current US market status
 */
export function getMarketStatus(): MarketStatusInfo {
  const now = new Date();

  // Format time in ET
  const etFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });

  const etParts = etFormatter.formatToParts(now);
  const hour = parseInt(etParts.find(p => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(etParts.find(p => p.type === 'minute')?.value || '0', 10);
  const totalMinutes = hour * 60 + minute;

  // Get day of week in ET
  const dayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  });
  const dayOfWeek = dayFormatter.format(now);

  // Market hours in minutes from midnight (ET)
  const PRE_MARKET_START = 4 * 60;      // 4:00 AM ET
  const MARKET_OPEN = 9 * 60 + 30;      // 9:30 AM ET
  const MARKET_CLOSE = 16 * 60;         // 4:00 PM ET
  const AFTER_HOURS_END = 20 * 60;      // 8:00 PM ET

  // Check if weekend
  if (dayOfWeek === 'Sat' || dayOfWeek === 'Sun') {
    return {
      status: 'closed',
      nextChange: 'Monday 4:00 AM ET',
      isExtendedHours: false,
    };
  }

  // Determine market status
  if (totalMinutes >= PRE_MARKET_START && totalMinutes < MARKET_OPEN) {
    return {
      status: 'pre-market',
      nextChange: '9:30 AM ET',
      isExtendedHours: true,
    };
  }

  if (totalMinutes >= MARKET_OPEN && totalMinutes < MARKET_CLOSE) {
    return {
      status: 'open',
      nextChange: '4:00 PM ET',
      isExtendedHours: false,
    };
  }

  if (totalMinutes >= MARKET_CLOSE && totalMinutes < AFTER_HOURS_END) {
    return {
      status: 'after-hours',
      nextChange: '8:00 PM ET',
      isExtendedHours: true,
    };
  }

  // Closed (before pre-market or after after-hours)
  return {
    status: 'closed',
    nextChange: '4:00 AM ET',
    isExtendedHours: false,
  };
}

/**
 * Check if market is currently open for regular trading
 */
export function isMarketOpen(): boolean {
  return getMarketStatus().status === 'open';
}

/**
 * Check if extended hours trading is available
 */
export function isExtendedHoursActive(): boolean {
  const status = getMarketStatus();
  return status.status === 'pre-market' || status.status === 'after-hours';
}

/**
 * Check if any trading is available (regular or extended)
 */
export function isTradingAvailable(): boolean {
  const status = getMarketStatus();
  return status.status !== 'closed';
}
