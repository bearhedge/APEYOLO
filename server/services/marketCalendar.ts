/**
 * US Market Calendar Service
 *
 * Handles market holidays, early close days, and trading hours
 * for scheduling jobs at the right times.
 */

export interface MarketDay {
  date: string;           // YYYY-MM-DD
  isOpen: boolean;
  closeTime: string;      // "16:00" (normal) or "13:00" (early close)
  holiday?: string;       // Holiday name if closed
  earlyClose?: boolean;   // True if early close day
}

export interface MarketStatus {
  isOpen: boolean;
  currentTimeET: string;
  marketCloseET: string;
  reason: string;
}

// US Stock Market Holidays (NYSE/NASDAQ)
// Updated for 2024-2026
const US_MARKET_HOLIDAYS: Record<string, string> = {
  // 2024
  '2024-01-01': "New Year's Day",
  '2024-01-15': 'Martin Luther King Jr. Day',
  '2024-02-19': "Presidents' Day",
  '2024-03-29': 'Good Friday',
  '2024-05-27': 'Memorial Day',
  '2024-06-19': 'Juneteenth',
  '2024-07-04': 'Independence Day',
  '2024-09-02': 'Labor Day',
  '2024-11-28': 'Thanksgiving Day',
  '2024-12-25': 'Christmas Day',
  // 2025
  '2025-01-01': "New Year's Day",
  '2025-01-20': 'Martin Luther King Jr. Day',
  '2025-02-17': "Presidents' Day",
  '2025-04-18': 'Good Friday',
  '2025-05-26': 'Memorial Day',
  '2025-06-19': 'Juneteenth',
  '2025-07-04': 'Independence Day',
  '2025-09-01': 'Labor Day',
  '2025-11-27': 'Thanksgiving Day',
  '2025-12-25': 'Christmas Day',
  // 2026
  '2026-01-01': "New Year's Day",
  '2026-01-19': 'Martin Luther King Jr. Day',
  '2026-02-16': "Presidents' Day",
  '2026-04-03': 'Good Friday',
  '2026-05-25': 'Memorial Day',
  '2026-06-19': 'Juneteenth',
  '2026-07-03': 'Independence Day (Observed)', // July 4th is Saturday
  '2026-09-07': 'Labor Day',
  '2026-11-26': 'Thanksgiving Day',
  '2026-12-25': 'Christmas Day',
};

// Early close days (market closes at 1:00 PM ET)
const EARLY_CLOSE_DAYS: Record<string, string> = {
  // 2024
  '2024-07-03': 'Day before Independence Day',
  '2024-11-29': 'Day after Thanksgiving',
  '2024-12-24': 'Christmas Eve',
  // 2025
  '2025-07-03': 'Day before Independence Day',
  '2025-11-28': 'Day after Thanksgiving',
  '2025-12-24': 'Christmas Eve',
  // 2026
  '2026-11-27': 'Day after Thanksgiving',
  '2026-12-24': 'Christmas Eve',
};

/**
 * Get date string in YYYY-MM-DD format for Eastern Time
 */
export function getETDateString(date: Date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/**
 * Get current time in ET as HH:MM
 */
export function getETTimeString(date: Date = new Date()): string {
  return date.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Check if a date is a weekend (Saturday or Sunday)
 */
export function isWeekend(date: Date): boolean {
  const etDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = etDate.getDay();
  return day === 0 || day === 6;
}

/**
 * Check if market is closed on this date (holiday)
 */
export function isMarketHoliday(date: Date = new Date()): { isHoliday: boolean; holiday?: string } {
  const dateStr = getETDateString(date);
  const holiday = US_MARKET_HOLIDAYS[dateStr];
  return {
    isHoliday: !!holiday,
    holiday,
  };
}

/**
 * Check if this is an early close day
 */
export function isEarlyCloseDay(date: Date = new Date()): { isEarlyClose: boolean; reason?: string } {
  const dateStr = getETDateString(date);
  const reason = EARLY_CLOSE_DAYS[dateStr];
  return {
    isEarlyClose: !!reason,
    reason,
  };
}

/**
 * Get the market close time for a specific date
 * Returns "16:00" (4 PM ET) normally, "13:00" (1 PM ET) on early close days
 */
export function getMarketCloseTime(date: Date = new Date()): string {
  const { isEarlyClose } = isEarlyCloseDay(date);
  return isEarlyClose ? '13:00' : '16:00';
}

/**
 * Check if the market is open on this date
 */
export function isMarketOpen(date: Date = new Date()): boolean {
  if (isWeekend(date)) return false;
  const { isHoliday } = isMarketHoliday(date);
  return !isHoliday;
}

// Market trading hours (Eastern Time)
const MARKET_OPEN_TIME = '09:30';
const MARKET_CLOSE_NORMAL = '16:00';
const MARKET_CLOSE_EARLY = '13:00';

/**
 * Get market status for a specific date/time
 * Now includes time-of-day check for accurate open/closed status
 */
export function getMarketStatus(date: Date = new Date()): MarketStatus {
  const dateStr = getETDateString(date);
  const timeStr = getETTimeString(date);
  const closeTime = getMarketCloseTime(date);

  // Weekend check
  if (isWeekend(date)) {
    return {
      isOpen: false,
      currentTimeET: timeStr,
      marketCloseET: closeTime,
      reason: 'Weekend - market closed',
    };
  }

  // Holiday check
  const { isHoliday, holiday } = isMarketHoliday(date);
  if (isHoliday) {
    return {
      isOpen: false,
      currentTimeET: timeStr,
      marketCloseET: closeTime,
      reason: `Holiday: ${holiday}`,
    };
  }

  // Early close day check
  const { isEarlyClose, reason: earlyCloseReason } = isEarlyCloseDay(date);
  const marketCloseToday = isEarlyClose ? MARKET_CLOSE_EARLY : MARKET_CLOSE_NORMAL;

  // Time-of-day check: Market is only open 9:30 AM - close time
  if (timeStr < MARKET_OPEN_TIME) {
    return {
      isOpen: false,
      currentTimeET: timeStr,
      marketCloseET: marketCloseToday,
      reason: `Pre-market - opens at 9:30 AM ET`,
    };
  }

  if (timeStr >= marketCloseToday) {
    const closeTimeFormatted = isEarlyClose ? '1:00 PM' : '4:00 PM';
    return {
      isOpen: false,
      currentTimeET: timeStr,
      marketCloseET: marketCloseToday,
      reason: `After hours - closed at ${closeTimeFormatted} ET`,
    };
  }

  // Market is open (within trading hours)
  const reasonStr = isEarlyClose
    ? `Open (early close at 1:00 PM ET - ${earlyCloseReason})`
    : 'Open (closes at 4:00 PM ET)';

  return {
    isOpen: true,
    currentTimeET: timeStr,
    marketCloseET: marketCloseToday,
    reason: reasonStr,
  };
}

/**
 * Get market day info for a specific date
 */
export function getMarketDay(date: Date = new Date()): MarketDay {
  const dateStr = getETDateString(date);
  const { isHoliday, holiday } = isMarketHoliday(date);
  const { isEarlyClose } = isEarlyCloseDay(date);
  const weekendClosed = isWeekend(date);

  return {
    date: dateStr,
    isOpen: !weekendClosed && !isHoliday,
    closeTime: isEarlyClose ? '13:00' : '16:00',
    holiday: weekendClosed ? 'Weekend' : holiday,
    earlyClose: isEarlyClose,
  };
}

/**
 * Get the next market open day from a given date
 */
export function getNextMarketDay(from: Date = new Date()): MarketDay {
  const date = new Date(from);
  // Start checking from tomorrow
  date.setDate(date.getDate() + 1);

  // Find the next open market day (max 10 days ahead to avoid infinite loop)
  for (let i = 0; i < 10; i++) {
    const marketDay = getMarketDay(date);
    if (marketDay.isOpen) {
      return marketDay;
    }
    date.setDate(date.getDate() + 1);
  }

  // Fallback - shouldn't happen
  return getMarketDay(date);
}

/**
 * Get market calendar for a date range
 */
export function getMarketCalendar(startDate: Date, days: number = 30): MarketDay[] {
  const calendar: MarketDay[] = [];
  const date = new Date(startDate);

  for (let i = 0; i < days; i++) {
    calendar.push(getMarketDay(date));
    date.setDate(date.getDate() + 1);
  }

  return calendar;
}

/**
 * Get upcoming market events (holidays and early close days)
 */
export function getUpcomingMarketEvents(days: number = 60): Array<{ date: string; event: string; type: 'holiday' | 'early_close' }> {
  const events: Array<{ date: string; event: string; type: 'holiday' | 'early_close' }> = [];
  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() + days);

  const todayStr = getETDateString(today);
  const endStr = getETDateString(endDate);

  // Add holidays
  for (const [date, holiday] of Object.entries(US_MARKET_HOLIDAYS)) {
    if (date >= todayStr && date <= endStr) {
      events.push({ date, event: holiday, type: 'holiday' });
    }
  }

  // Add early close days
  for (const [date, reason] of Object.entries(EARLY_CLOSE_DAYS)) {
    if (date >= todayStr && date <= endStr) {
      events.push({ date, event: `Early Close: ${reason}`, type: 'early_close' });
    }
  }

  // Sort by date
  events.sort((a, b) => a.date.localeCompare(b.date));

  return events;
}

/**
 * Calculate the optimal job trigger time for a given date
 * Returns time 5 minutes before market close
 */
export function getJobTriggerTime(date: Date = new Date()): string {
  const closeTime = getMarketCloseTime(date);
  const [hours, minutes] = closeTime.split(':').map(Number);

  // 5 minutes before close
  let triggerMinutes = hours * 60 + minutes - 5;
  const triggerHours = Math.floor(triggerMinutes / 60);
  triggerMinutes = triggerMinutes % 60;

  return `${String(triggerHours).padStart(2, '0')}:${String(triggerMinutes).padStart(2, '0')}`;
}
