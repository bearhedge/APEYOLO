/**
 * CalendarWindow - Monthly calendar view for market events
 *
 * Shows: Holidays, Early Closes, Economic Events (FOMC, CPI, NFP, etc.), Mag7 Earnings
 */

import { useState, useMemo } from 'react';
import { useJobs } from '../../../hooks/useJobs';

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

function getCalendarDays(year: number, month: number, eventMap: Map<string, CalendarEvent[]>): CalendarDay[] {
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
      events: eventMap.get(dateStr) || [],
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
      events: eventMap.get(dateStr) || [],
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
      events: eventMap.get(dateStr) || [],
    });
  }

  return days;
}

// ============================================
// Components
// ============================================

export function CalendarWindow() {
  const { calendarQuery } = useJobs();
  const { data: calendarData, isLoading, error } = calendarQuery;

  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<CalendarDay | null>(null);

  // Build event map from API data
  const eventMap = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    if (!calendarData?.upcomingEvents) return map;
    for (const event of calendarData.upcomingEvents) {
      const existing = map.get(event.date) || [];
      existing.push({
        type: event.type,
        name: event.event,
        time: event.time,
      });
      map.set(event.date, existing);
    }
    return map;
  }, [calendarData?.upcomingEvents]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const days = useMemo(() => getCalendarDays(year, month, eventMap), [year, month, eventMap]);

  const goToPrevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const goToNextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToToday = () => setCurrentDate(new Date());

  // Loading state
  if (isLoading) {
    return (
      <div style={{
        height: '100%',
        backgroundColor: '#0a0a0a',
        fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
        color: '#666',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        Loading calendar...
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div style={{
        height: '100%',
        backgroundColor: '#0a0a0a',
        fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
        color: '#ef4444',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        textAlign: 'center',
      }}>
        Failed to load calendar: {error.message}
      </div>
    );
  }

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
