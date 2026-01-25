/**
 * CalendarWindow - Monthly calendar view for market events
 *
 * Terminal aesthetic calendar showing holidays, early closes, and economic events.
 */

import { useState, useMemo } from 'react';
import { useJobs } from '@/hooks/useJobs';

// Event type colors
const EVENT_COLORS = {
  holiday: '#ef4444',     // Red
  early_close: '#f59e0b', // Yellow
  economic: '#3b82f6',    // Blue
};

// Days of week headers
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Month names
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

interface CalendarDay {
  date: Date;
  day: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  events: Array<{
    type: 'holiday' | 'early_close' | 'economic';
    name: string;
  }>;
}

function getCalendarDays(year: number, month: number, eventMap: Map<string, Array<{ type: string; name: string }>>): CalendarDay[] {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startPadding = firstDay.getDay();
  const totalDays = lastDay.getDate();

  const days: CalendarDay[] = [];

  // Previous month padding
  const prevMonth = new Date(year, month, 0);
  const prevMonthDays = prevMonth.getDate();
  for (let i = startPadding - 1; i >= 0; i--) {
    const day = prevMonthDays - i;
    const date = new Date(year, month - 1, day);
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    days.push({
      date,
      day,
      isCurrentMonth: false,
      isToday: dateStr === todayStr,
      events: (eventMap.get(dateStr) || []) as CalendarDay['events'],
    });
  }

  // Current month
  for (let day = 1; day <= totalDays; day++) {
    const date = new Date(year, month, day);
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    days.push({
      date,
      day,
      isCurrentMonth: true,
      isToday: dateStr === todayStr,
      events: (eventMap.get(dateStr) || []) as CalendarDay['events'],
    });
  }

  // Next month padding (fill to 42 cells for 6 rows)
  const remaining = 42 - days.length;
  for (let day = 1; day <= remaining; day++) {
    const date = new Date(year, month + 1, day);
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 2).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    days.push({
      date,
      day,
      isCurrentMonth: false,
      isToday: dateStr === todayStr,
      events: (eventMap.get(dateStr) || []) as CalendarDay['events'],
    });
  }

  return days;
}

export function CalendarWindow() {
  const { upcomingEvents, calendar } = useJobs();
  const [currentDate, setCurrentDate] = useState(() => new Date());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Build event map from API data
  const eventMap = useMemo(() => {
    const map = new Map<string, Array<{ type: string; name: string }>>();

    // Add events from upcomingEvents
    for (const event of upcomingEvents) {
      const existing = map.get(event.date) || [];
      existing.push({ type: event.type, name: event.event });
      map.set(event.date, existing);
    }

    // Add holiday/early close info from calendar
    for (const day of calendar) {
      if (day.holiday) {
        const existing = map.get(day.date) || [];
        if (!existing.some(e => e.type === 'holiday')) {
          existing.push({ type: 'holiday', name: day.holiday });
          map.set(day.date, existing);
        }
      }
      if (day.earlyClose) {
        const existing = map.get(day.date) || [];
        if (!existing.some(e => e.type === 'early_close')) {
          existing.push({ type: 'early_close', name: 'Early Close' });
          map.set(day.date, existing);
        }
      }
    }

    return map;
  }, [upcomingEvents, calendar]);

  const days = useMemo(() => getCalendarDays(year, month, eventMap), [year, month, eventMap]);

  const goToPrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const containerStyle: React.CSSProperties = {
    height: '100%',
    backgroundColor: '#0a0a0a',
    fontFamily: '"IBM Plex Mono", monospace',
    color: '#e5e5e5',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  };

  const navButtonStyle: React.CSSProperties = {
    background: 'none',
    border: '1px solid #333',
    color: '#888',
    padding: '4px 8px',
    cursor: 'pointer',
    fontSize: '14px',
    borderRadius: '2px',
  };

  const monthTitleStyle: React.CSSProperties = {
    fontSize: '14px',
    fontWeight: 500,
  };

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(7, 1fr)',
    gap: '1px',
    flex: 1,
    minHeight: 0,
  };

  const dayHeaderStyle: React.CSSProperties = {
    textAlign: 'center',
    padding: '8px 0',
    fontSize: '10px',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };

  const legendStyle: React.CSSProperties = {
    display: 'flex',
    gap: '16px',
    marginTop: '12px',
    paddingTop: '12px',
    borderTop: '1px solid #222',
    fontSize: '10px',
  };

  const legendItemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    color: '#666',
  };

  return (
    <div style={containerStyle}>
      {/* Header with navigation */}
      <div style={headerStyle}>
        <button
          style={navButtonStyle}
          onClick={goToPrevMonth}
          onMouseOver={e => e.currentTarget.style.borderColor = '#555'}
          onMouseOut={e => e.currentTarget.style.borderColor = '#333'}
        >
          &lt;
        </button>
        <span style={monthTitleStyle}>
          {MONTHS[month]} {year}
        </span>
        <button
          style={navButtonStyle}
          onClick={goToNextMonth}
          onMouseOver={e => e.currentTarget.style.borderColor = '#555'}
          onMouseOut={e => e.currentTarget.style.borderColor = '#333'}
        >
          &gt;
        </button>
      </div>

      {/* Day headers */}
      <div style={gridStyle}>
        {DAYS.map(day => (
          <div key={day} style={dayHeaderStyle}>{day}</div>
        ))}

        {/* Calendar days */}
        {days.map((day, i) => (
          <DayCell key={i} day={day} />
        ))}
      </div>

      {/* Legend */}
      <div style={legendStyle}>
        <div style={legendItemStyle}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: EVENT_COLORS.holiday }} />
          <span>Holiday</span>
        </div>
        <div style={legendItemStyle}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: EVENT_COLORS.early_close }} />
          <span>Early Close</span>
        </div>
        <div style={legendItemStyle}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: EVENT_COLORS.economic }} />
          <span>Economic</span>
        </div>
      </div>
    </div>
  );
}

function DayCell({ day }: { day: CalendarDay }) {
  const cellStyle: React.CSSProperties = {
    aspectRatio: '1',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    color: day.isCurrentMonth ? '#e5e5e5' : '#444',
    backgroundColor: day.isToday ? '#1a1a2e' : 'transparent',
    border: day.isToday ? '1px solid #333' : '1px solid transparent',
    borderRadius: '2px',
    position: 'relative',
    cursor: day.events.length > 0 ? 'help' : 'default',
  };

  const dayNumberStyle: React.CSSProperties = {
    fontWeight: day.isToday ? 600 : 400,
    color: day.isToday ? '#fff' : undefined,
  };

  const dotsContainerStyle: React.CSSProperties = {
    display: 'flex',
    gap: '2px',
    marginTop: '2px',
    position: 'absolute',
    bottom: '4px',
  };

  // Get unique event types for this day
  const eventTypes = [...new Set(day.events.map(e => e.type))];

  return (
    <div
      style={cellStyle}
      title={day.events.length > 0 ? day.events.map(e => e.name).join('\n') : undefined}
    >
      <span style={dayNumberStyle}>{day.day}</span>
      {eventTypes.length > 0 && (
        <div style={dotsContainerStyle}>
          {eventTypes.map((type, i) => (
            <span
              key={i}
              style={{
                width: '5px',
                height: '5px',
                borderRadius: '50%',
                backgroundColor: EVENT_COLORS[type as keyof typeof EVENT_COLORS] || '#888',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
