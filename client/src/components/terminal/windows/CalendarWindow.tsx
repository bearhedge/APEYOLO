/**
 * CalendarWindow - Monthly calendar view for market events
 *
 * Shows: Holidays, Early Closes, Economic Events (FOMC, CPI, NFP, etc.), Mag7 Earnings
 */

import { useState, useMemo } from 'react';

// ============================================
// Event Colors
// ============================================

const EVENT_COLORS = {
  holiday: '#ef4444',      // Red - market closed
  early_close: '#f59e0b',  // Yellow - early close
  economic: '#3b82f6',     // Blue - economic event
  earnings: '#a855f7',     // Purple - earnings
};

// ============================================
// Static Data: US Market Holidays 2025-2026
// ============================================

const US_HOLIDAYS: Record<string, string> = {
  // 2025
  '2025-01-01': "New Year's Day",
  '2025-01-20': 'MLK Day',
  '2025-02-17': "Presidents' Day",
  '2025-04-18': 'Good Friday',
  '2025-05-26': 'Memorial Day',
  '2025-06-19': 'Juneteenth',
  '2025-07-04': 'Independence Day',
  '2025-09-01': 'Labor Day',
  '2025-11-27': 'Thanksgiving',
  '2025-12-25': 'Christmas',
  // 2026
  '2026-01-01': "New Year's Day",
  '2026-01-19': 'MLK Day',
  '2026-02-16': "Presidents' Day",
  '2026-04-03': 'Good Friday',
  '2026-05-25': 'Memorial Day',
  '2026-06-19': 'Juneteenth',
  '2026-07-03': 'Independence Day',
  '2026-09-07': 'Labor Day',
  '2026-11-26': 'Thanksgiving',
  '2026-12-25': 'Christmas',
};

const EARLY_CLOSE_DAYS: Record<string, string> = {
  // 2025
  '2025-07-03': 'Early Close',
  '2025-11-28': 'Early Close',
  '2025-12-24': 'Early Close',
  // 2026
  '2026-11-27': 'Early Close',
  '2026-12-24': 'Early Close',
};

// ============================================
// Static Data: Key Economic Events 2025-2026
// FOMC meetings, CPI, NFP (first Friday of month)
// ============================================

const ECONOMIC_EVENTS: Record<string, Array<{ name: string; time?: string; impact: 'high' | 'critical' }>> = {
  // 2025 FOMC Meetings (8 per year)
  '2025-01-29': [{ name: 'FOMC Rate Decision', time: '2:00 PM', impact: 'critical' }],
  '2025-03-19': [{ name: 'FOMC Rate Decision', time: '2:00 PM', impact: 'critical' }],
  '2025-05-07': [{ name: 'FOMC Rate Decision', time: '2:00 PM', impact: 'critical' }],
  '2025-06-18': [{ name: 'FOMC Rate Decision', time: '2:00 PM', impact: 'critical' }],
  '2025-07-30': [{ name: 'FOMC Rate Decision', time: '2:00 PM', impact: 'critical' }],
  '2025-09-17': [{ name: 'FOMC Rate Decision', time: '2:00 PM', impact: 'critical' }],
  '2025-11-05': [{ name: 'FOMC Rate Decision', time: '2:00 PM', impact: 'critical' }],
  '2025-12-17': [{ name: 'FOMC Rate Decision', time: '2:00 PM', impact: 'critical' }],
  // 2026 FOMC Meetings
  '2026-01-28': [{ name: 'FOMC Rate Decision', time: '2:00 PM', impact: 'critical' }],
  '2026-03-18': [{ name: 'FOMC Rate Decision', time: '2:00 PM', impact: 'critical' }],
  '2026-05-06': [{ name: 'FOMC Rate Decision', time: '2:00 PM', impact: 'critical' }],
  '2026-06-17': [{ name: 'FOMC Rate Decision', time: '2:00 PM', impact: 'critical' }],
  '2026-07-29': [{ name: 'FOMC Rate Decision', time: '2:00 PM', impact: 'critical' }],
  '2026-09-16': [{ name: 'FOMC Rate Decision', time: '2:00 PM', impact: 'critical' }],
  '2026-11-04': [{ name: 'FOMC Rate Decision', time: '2:00 PM', impact: 'critical' }],
  '2026-12-16': [{ name: 'FOMC Rate Decision', time: '2:00 PM', impact: 'critical' }],

  // 2025 CPI Releases (around 12th of each month)
  '2025-01-15': [{ name: 'CPI Report', time: '8:30 AM', impact: 'high' }],
  '2025-02-12': [{ name: 'CPI Report', time: '8:30 AM', impact: 'high' }],
  '2025-03-12': [{ name: 'CPI Report', time: '8:30 AM', impact: 'high' }],
  '2025-04-10': [{ name: 'CPI Report', time: '8:30 AM', impact: 'high' }],
  '2025-05-13': [{ name: 'CPI Report', time: '8:30 AM', impact: 'high' }],
  '2025-06-11': [{ name: 'CPI Report', time: '8:30 AM', impact: 'high' }],
  '2025-07-11': [{ name: 'CPI Report', time: '8:30 AM', impact: 'high' }],
  '2025-08-13': [{ name: 'CPI Report', time: '8:30 AM', impact: 'high' }],
  '2025-09-10': [{ name: 'CPI Report', time: '8:30 AM', impact: 'high' }],
  '2025-10-10': [{ name: 'CPI Report', time: '8:30 AM', impact: 'high' }],
  '2025-11-13': [{ name: 'CPI Report', time: '8:30 AM', impact: 'high' }],
  '2025-12-10': [{ name: 'CPI Report', time: '8:30 AM', impact: 'high' }],
  // 2026 CPI
  '2026-01-14': [{ name: 'CPI Report', time: '8:30 AM', impact: 'high' }],
  '2026-02-11': [{ name: 'CPI Report', time: '8:30 AM', impact: 'high' }],
  '2026-03-11': [{ name: 'CPI Report', time: '8:30 AM', impact: 'high' }],
  '2026-04-14': [{ name: 'CPI Report', time: '8:30 AM', impact: 'high' }],
  '2026-05-12': [{ name: 'CPI Report', time: '8:30 AM', impact: 'high' }],
  '2026-06-10': [{ name: 'CPI Report', time: '8:30 AM', impact: 'high' }],
  '2026-07-14': [{ name: 'CPI Report', time: '8:30 AM', impact: 'high' }],
  '2026-08-12': [{ name: 'CPI Report', time: '8:30 AM', impact: 'high' }],
  '2026-09-15': [{ name: 'CPI Report', time: '8:30 AM', impact: 'high' }],
  '2026-10-13': [{ name: 'CPI Report', time: '8:30 AM', impact: 'high' }],
  '2026-11-12': [{ name: 'CPI Report', time: '8:30 AM', impact: 'high' }],
  '2026-12-10': [{ name: 'CPI Report', time: '8:30 AM', impact: 'high' }],

  // 2025 NFP (Jobs Report - first Friday of month)
  '2025-01-10': [{ name: 'Jobs Report (NFP)', time: '8:30 AM', impact: 'high' }],
  '2025-02-07': [{ name: 'Jobs Report (NFP)', time: '8:30 AM', impact: 'high' }],
  '2025-03-07': [{ name: 'Jobs Report (NFP)', time: '8:30 AM', impact: 'high' }],
  '2025-04-04': [{ name: 'Jobs Report (NFP)', time: '8:30 AM', impact: 'high' }],
  '2025-05-02': [{ name: 'Jobs Report (NFP)', time: '8:30 AM', impact: 'high' }],
  '2025-06-06': [{ name: 'Jobs Report (NFP)', time: '8:30 AM', impact: 'high' }],
  '2025-07-03': [{ name: 'Jobs Report (NFP)', time: '8:30 AM', impact: 'high' }],
  '2025-08-01': [{ name: 'Jobs Report (NFP)', time: '8:30 AM', impact: 'high' }],
  '2025-09-05': [{ name: 'Jobs Report (NFP)', time: '8:30 AM', impact: 'high' }],
  '2025-10-03': [{ name: 'Jobs Report (NFP)', time: '8:30 AM', impact: 'high' }],
  '2025-11-07': [{ name: 'Jobs Report (NFP)', time: '8:30 AM', impact: 'high' }],
  '2025-12-05': [{ name: 'Jobs Report (NFP)', time: '8:30 AM', impact: 'high' }],
  // 2026 NFP
  '2026-01-09': [{ name: 'Jobs Report (NFP)', time: '8:30 AM', impact: 'high' }],
  '2026-02-06': [{ name: 'Jobs Report (NFP)', time: '8:30 AM', impact: 'high' }],
  '2026-03-06': [{ name: 'Jobs Report (NFP)', time: '8:30 AM', impact: 'high' }],
  '2026-04-03': [{ name: 'Jobs Report (NFP)', time: '8:30 AM', impact: 'high' }],
  '2026-05-01': [{ name: 'Jobs Report (NFP)', time: '8:30 AM', impact: 'high' }],
  '2026-06-05': [{ name: 'Jobs Report (NFP)', time: '8:30 AM', impact: 'high' }],
  '2026-07-02': [{ name: 'Jobs Report (NFP)', time: '8:30 AM', impact: 'high' }],
  '2026-08-07': [{ name: 'Jobs Report (NFP)', time: '8:30 AM', impact: 'high' }],
  '2026-09-04': [{ name: 'Jobs Report (NFP)', time: '8:30 AM', impact: 'high' }],
  '2026-10-02': [{ name: 'Jobs Report (NFP)', time: '8:30 AM', impact: 'high' }],
  '2026-11-06': [{ name: 'Jobs Report (NFP)', time: '8:30 AM', impact: 'high' }],
  '2026-12-04': [{ name: 'Jobs Report (NFP)', time: '8:30 AM', impact: 'high' }],
};

// ============================================
// Static Data: Mag7 Earnings (Approximate dates)
// These are estimated based on historical patterns
// ============================================

const MAG7_EARNINGS: Record<string, Array<{ ticker: string; name: string }>> = {
  // Q4 2024 Earnings (reported Jan-Feb 2025)
  '2025-01-29': [{ ticker: 'MSFT', name: 'Microsoft Earnings' }],
  '2025-01-30': [{ ticker: 'AAPL', name: 'Apple Earnings' }, { ticker: 'META', name: 'Meta Earnings' }],
  '2025-02-04': [{ ticker: 'GOOGL', name: 'Google Earnings' }, { ticker: 'AMZN', name: 'Amazon Earnings' }],
  '2025-02-26': [{ ticker: 'NVDA', name: 'Nvidia Earnings' }],
  '2025-01-29': [{ ticker: 'TSLA', name: 'Tesla Earnings' }],

  // Q1 2025 Earnings (reported Apr-May 2025)
  '2025-04-23': [{ ticker: 'TSLA', name: 'Tesla Earnings' }, { ticker: 'META', name: 'Meta Earnings' }],
  '2025-04-29': [{ ticker: 'MSFT', name: 'Microsoft Earnings' }, { ticker: 'GOOGL', name: 'Google Earnings' }],
  '2025-05-01': [{ ticker: 'AAPL', name: 'Apple Earnings' }, { ticker: 'AMZN', name: 'Amazon Earnings' }],
  '2025-05-28': [{ ticker: 'NVDA', name: 'Nvidia Earnings' }],

  // Q2 2025 Earnings (reported Jul-Aug 2025)
  '2025-07-22': [{ ticker: 'TSLA', name: 'Tesla Earnings' }, { ticker: 'GOOGL', name: 'Google Earnings' }],
  '2025-07-29': [{ ticker: 'MSFT', name: 'Microsoft Earnings' }],
  '2025-07-30': [{ ticker: 'META', name: 'Meta Earnings' }],
  '2025-07-31': [{ ticker: 'AAPL', name: 'Apple Earnings' }, { ticker: 'AMZN', name: 'Amazon Earnings' }],
  '2025-08-27': [{ ticker: 'NVDA', name: 'Nvidia Earnings' }],

  // Q3 2025 Earnings (reported Oct-Nov 2025)
  '2025-10-21': [{ ticker: 'TSLA', name: 'Tesla Earnings' }],
  '2025-10-28': [{ ticker: 'GOOGL', name: 'Google Earnings' }, { ticker: 'MSFT', name: 'Microsoft Earnings' }],
  '2025-10-29': [{ ticker: 'META', name: 'Meta Earnings' }],
  '2025-10-30': [{ ticker: 'AAPL', name: 'Apple Earnings' }, { ticker: 'AMZN', name: 'Amazon Earnings' }],
  '2025-11-19': [{ ticker: 'NVDA', name: 'Nvidia Earnings' }],

  // Q4 2025 Earnings (reported Jan-Feb 2026)
  '2026-01-28': [{ ticker: 'TSLA', name: 'Tesla Earnings' }, { ticker: 'MSFT', name: 'Microsoft Earnings' }],
  '2026-01-29': [{ ticker: 'META', name: 'Meta Earnings' }],
  '2026-02-03': [{ ticker: 'GOOGL', name: 'Google Earnings' }, { ticker: 'AMZN', name: 'Amazon Earnings' }],
  '2026-02-05': [{ ticker: 'AAPL', name: 'Apple Earnings' }],
  '2026-02-25': [{ ticker: 'NVDA', name: 'Nvidia Earnings' }],
};

// ============================================
// Helper Functions
// ============================================

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

interface CalendarEvent {
  type: 'holiday' | 'early_close' | 'economic' | 'earnings';
  name: string;
  time?: string;
}

interface CalendarDay {
  date: Date;
  day: number;
  dateStr: string;
  isCurrentMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  events: CalendarEvent[];
}

function formatDateStr(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getEventsForDate(dateStr: string): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  // Check holidays
  if (US_HOLIDAYS[dateStr]) {
    events.push({ type: 'holiday', name: US_HOLIDAYS[dateStr] });
  }

  // Check early close
  if (EARLY_CLOSE_DAYS[dateStr]) {
    events.push({ type: 'early_close', name: EARLY_CLOSE_DAYS[dateStr] });
  }

  // Check economic events
  if (ECONOMIC_EVENTS[dateStr]) {
    for (const event of ECONOMIC_EVENTS[dateStr]) {
      events.push({ type: 'economic', name: event.name, time: event.time });
    }
  }

  // Check earnings
  if (MAG7_EARNINGS[dateStr]) {
    for (const earning of MAG7_EARNINGS[dateStr]) {
      events.push({ type: 'earnings', name: `${earning.ticker} Earnings` });
    }
  }

  return events;
}

function getCalendarDays(year: number, month: number): CalendarDay[] {
  const today = new Date();
  const todayStr = formatDateStr(today.getFullYear(), today.getMonth(), today.getDate());

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startPadding = firstDay.getDay();
  const totalDays = lastDay.getDate();

  const days: CalendarDay[] = [];

  // Previous month padding
  const prevMonth = new Date(year, month, 0);
  const prevMonthDays = prevMonth.getDate();
  const prevYear = month === 0 ? year - 1 : year;
  const prevMonthNum = month === 0 ? 11 : month - 1;

  for (let i = startPadding - 1; i >= 0; i--) {
    const day = prevMonthDays - i;
    const date = new Date(prevYear, prevMonthNum, day);
    const dateStr = formatDateStr(prevYear, prevMonthNum, day);
    const dayOfWeek = date.getDay();
    days.push({
      date,
      day,
      dateStr,
      isCurrentMonth: false,
      isToday: dateStr === todayStr,
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
      events: getEventsForDate(dateStr),
    });
  }

  // Current month
  for (let day = 1; day <= totalDays; day++) {
    const date = new Date(year, month, day);
    const dateStr = formatDateStr(year, month, day);
    const dayOfWeek = date.getDay();
    days.push({
      date,
      day,
      dateStr,
      isCurrentMonth: true,
      isToday: dateStr === todayStr,
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
      events: getEventsForDate(dateStr),
    });
  }

  // Next month padding (fill to 42 cells for 6 rows)
  const remaining = 42 - days.length;
  const nextYear = month === 11 ? year + 1 : year;
  const nextMonthNum = month === 11 ? 0 : month + 1;

  for (let day = 1; day <= remaining; day++) {
    const date = new Date(nextYear, nextMonthNum, day);
    const dateStr = formatDateStr(nextYear, nextMonthNum, day);
    const dayOfWeek = date.getDay();
    days.push({
      date,
      day,
      dateStr,
      isCurrentMonth: false,
      isToday: dateStr === todayStr,
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
      events: getEventsForDate(dateStr),
    });
  }

  return days;
}

// ============================================
// Components
// ============================================

export function CalendarWindow() {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<CalendarDay | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const days = useMemo(() => getCalendarDays(year, month), [year, month]);

  const goToPrevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const goToNextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToToday = () => setCurrentDate(new Date());

  return (
    <div style={{
      height: '100%',
      backgroundColor: '#0a0a0a',
      fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
      color: '#e5e5e5',
      padding: '12px',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '12px',
      }}>
        <button onClick={goToPrevMonth} style={navBtnStyle}>&lt;</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '14px', fontWeight: 500 }}>
            {MONTHS[month]} {year}
          </span>
          <button onClick={goToToday} style={{ ...navBtnStyle, fontSize: '10px', padding: '2px 6px' }}>
            Today
          </button>
        </div>
        <button onClick={goToNextMonth} style={navBtnStyle}>&gt;</button>
      </div>

      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '1px', marginBottom: '4px' }}>
        {DAYS.map(day => (
          <div key={day} style={{
            textAlign: 'center',
            padding: '4px 0',
            fontSize: '9px',
            color: '#666',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: '1px',
        flex: 1,
        minHeight: 0,
      }}>
        {days.map((day, i) => (
          <DayCell
            key={i}
            day={day}
            onClick={() => day.events.length > 0 && setSelectedDay(day)}
          />
        ))}
      </div>

      {/* Legend */}
      <div style={{
        display: 'flex',
        gap: '12px',
        marginTop: '8px',
        paddingTop: '8px',
        borderTop: '1px solid #222',
        fontSize: '9px',
        flexWrap: 'wrap',
      }}>
        <LegendItem color={EVENT_COLORS.holiday} label="Holiday" />
        <LegendItem color={EVENT_COLORS.early_close} label="Early Close" />
        <LegendItem color={EVENT_COLORS.economic} label="Econ" />
        <LegendItem color={EVENT_COLORS.earnings} label="Earnings" />
      </div>

      {/* Selected day popup */}
      {selectedDay && (
        <div style={{
          position: 'absolute',
          bottom: '60px',
          left: '12px',
          right: '12px',
          backgroundColor: '#1a1a1a',
          border: '1px solid #333',
          borderRadius: '4px',
          padding: '12px',
          maxHeight: '150px',
          overflow: 'auto',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontWeight: 500, fontSize: '12px' }}>
              {selectedDay.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </span>
            <button
              onClick={() => setSelectedDay(null)}
              style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: '14px' }}
            >
              x
            </button>
          </div>
          {selectedDay.events.map((event, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', fontSize: '11px' }}>
              <span style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: EVENT_COLORS[event.type],
                flexShrink: 0,
              }} />
              <span>{event.name}</span>
              {event.time && <span style={{ color: '#666' }}>{event.time}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const navBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid #333',
  color: '#888',
  padding: '4px 10px',
  cursor: 'pointer',
  fontSize: '12px',
  borderRadius: '2px',
};

function DayCell({ day, onClick }: { day: CalendarDay; onClick: () => void }) {
  const hasEvents = day.events.length > 0;

  // Get unique event types
  const eventTypes = [...new Set(day.events.map(e => e.type))];

  return (
    <div
      onClick={hasEvents ? onClick : undefined}
      style={{
        aspectRatio: '1',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '11px',
        color: day.isCurrentMonth
          ? (day.isWeekend ? '#666' : '#e5e5e5')
          : '#333',
        backgroundColor: day.isToday ? '#1a1a2e' : 'transparent',
        border: day.isToday ? '1px solid #444' : '1px solid transparent',
        borderRadius: '2px',
        cursor: hasEvents ? 'pointer' : 'default',
        position: 'relative',
        transition: 'background-color 0.1s',
      }}
      onMouseOver={e => {
        if (hasEvents) e.currentTarget.style.backgroundColor = '#1a1a1a';
      }}
      onMouseOut={e => {
        e.currentTarget.style.backgroundColor = day.isToday ? '#1a1a2e' : 'transparent';
      }}
    >
      <span style={{ fontWeight: day.isToday ? 600 : 400 }}>{day.day}</span>

      {eventTypes.length > 0 && (
        <div style={{
          display: 'flex',
          gap: '2px',
          marginTop: '2px',
          position: 'absolute',
          bottom: '3px',
        }}>
          {eventTypes.map((type, i) => (
            <span
              key={i}
              style={{
                width: '4px',
                height: '4px',
                borderRadius: '50%',
                backgroundColor: EVENT_COLORS[type],
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#666' }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: color }} />
      <span>{label}</span>
    </div>
  );
}
