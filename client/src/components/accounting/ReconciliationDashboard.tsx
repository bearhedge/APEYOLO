/**
 * ReconciliationDashboard - Calendar view of daily reconciliation status
 *
 * Shows a monthly calendar with color-coded reconciliation status:
 * - Green: Reconciled (auto or manual)
 * - Yellow: Pending reconciliation
 * - Red: Discrepancy found
 * - Gray: No snapshot
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

interface DailySnapshot {
  id: string;
  snapshotDate: string;
  internalNav: string;
  ibkrNav: string;
  navVariance: string;
  reconciliationStatus: string;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

export function ReconciliationDashboard() {
  const [currentDate, setCurrentDate] = useState(new Date());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Get first and last day of month
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;

  const { data, isLoading, error } = useQuery<{ success: boolean; data: DailySnapshot[] }>({
    queryKey: ['snapshots', startDate, endDate],
    queryFn: async () => {
      const res = await fetch(`/api/accounting/snapshots?startDate=${startDate}&endDate=${endDate}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch snapshots');
      return res.json();
    },
    refetchInterval: 60000,
  });

  const snapshots = data?.data || [];

  const getSnapshotForDate = (day: number): DailySnapshot | undefined => {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return snapshots.find(s => s.snapshotDate === dateStr);
  };

  const getStatusStyle = (status: string | undefined) => {
    switch (status) {
      case 'auto_reconciled':
      case 'manual_reconciled':
        return { background: 'rgba(34, 197, 94, 0.2)', borderColor: '#22c55e' };
      case 'pending':
        return { background: 'rgba(234, 179, 8, 0.2)', borderColor: '#eab308' };
      case 'discrepancy':
        return { background: 'rgba(239, 68, 68, 0.2)', borderColor: '#ef4444' };
      default:
        return { background: 'rgba(75, 85, 99, 0.1)', borderColor: '#374151' };
    }
  };

  const prevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  // Build calendar grid
  const daysInMonth = lastDay.getDate();
  const startDayOfWeek = firstDay.getDay();
  const weeks: (number | null)[][] = [];
  let currentWeek: (number | null)[] = [];

  // Fill in empty cells before first day
  for (let i = 0; i < startDayOfWeek; i++) {
    currentWeek.push(null);
  }

  // Fill in days
  for (let day = 1; day <= daysInMonth; day++) {
    currentWeek.push(day);
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  }

  // Fill in remaining empty cells
  while (currentWeek.length < 7 && currentWeek.length > 0) {
    currentWeek.push(null);
  }
  if (currentWeek.length > 0) {
    weeks.push(currentWeek);
  }

  const formatNav = (nav: string | undefined) => {
    if (!nav) return '-';
    const num = parseFloat(nav);
    return `$${num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  const formatVariance = (variance: string | undefined) => {
    if (!variance) return '';
    const num = parseFloat(variance);
    if (Math.abs(num) < 0.01) return '';
    const formatted = Math.abs(num).toFixed(2);
    return num > 0 ? `+$${formatted}` : `-$${formatted}`;
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px' }}>
      {/* Month navigation */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px',
        borderBottom: '1px solid #333',
      }}>
        <button
          onClick={prevMonth}
          style={{
            background: 'none',
            border: '1px solid #444',
            color: '#9ca3af',
            padding: '4px 12px',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          &lt;
        </button>
        <span style={{ color: '#fff', fontWeight: 'bold' }}>
          {MONTHS[month]} {year}
        </span>
        <button
          onClick={nextMonth}
          style={{
            background: 'none',
            border: '1px solid #444',
            color: '#9ca3af',
            padding: '4px 12px',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          &gt;
        </button>
      </div>

      {/* Legend */}
      <div style={{
        display: 'flex',
        gap: '16px',
        padding: '8px',
        borderBottom: '1px solid #333',
        color: '#666',
        fontSize: '10px',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '12px', height: '12px', background: 'rgba(34, 197, 94, 0.2)', border: '1px solid #22c55e' }} />
          Reconciled
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '12px', height: '12px', background: 'rgba(234, 179, 8, 0.2)', border: '1px solid #eab308' }} />
          Pending
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ width: '12px', height: '12px', background: 'rgba(239, 68, 68, 0.2)', border: '1px solid #ef4444' }} />
          Discrepancy
        </span>
      </div>

      {/* Calendar */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px' }}>
        {isLoading && (
          <div style={{ color: '#666', padding: '16px' }}>Loading snapshots...</div>
        )}

        {error && (
          <div style={{ color: '#ef4444', padding: '16px' }}>
            Error: {(error as Error).message}
          </div>
        )}

        {!isLoading && !error && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
            {/* Day headers */}
            {DAYS.map(day => (
              <div
                key={day}
                style={{
                  textAlign: 'center',
                  padding: '4px',
                  color: '#666',
                  fontSize: '10px',
                }}
              >
                {day}
              </div>
            ))}

            {/* Calendar cells */}
            {weeks.map((week, weekIdx) =>
              week.map((day, dayIdx) => {
                if (day === null) {
                  return <div key={`empty-${weekIdx}-${dayIdx}`} style={{ padding: '8px' }} />;
                }

                const snapshot = getSnapshotForDate(day);
                const isWeekend = dayIdx === 0 || dayIdx === 6;
                const statusStyle = getStatusStyle(snapshot?.reconciliationStatus);

                return (
                  <div
                    key={`day-${day}`}
                    style={{
                      padding: '8px',
                      border: `1px solid ${statusStyle.borderColor}`,
                      background: statusStyle.background,
                      opacity: isWeekend ? 0.5 : 1,
                      minHeight: '60px',
                    }}
                  >
                    <div style={{ color: '#fff', marginBottom: '4px' }}>{day}</div>
                    {snapshot && (
                      <>
                        <div style={{ color: '#9ca3af', fontSize: '9px' }}>
                          {formatNav(snapshot.internalNav)}
                        </div>
                        {snapshot.navVariance && parseFloat(snapshot.navVariance) !== 0 && (
                          <div style={{
                            color: parseFloat(snapshot.navVariance) > 0 ? '#22c55e' : '#ef4444',
                            fontSize: '9px',
                          }}>
                            {formatVariance(snapshot.navVariance)}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Summary footer */}
      <div style={{
        padding: '8px',
        borderTop: '1px solid #333',
        display: 'flex',
        justifyContent: 'space-between',
        color: '#666',
        fontSize: '10px',
      }}>
        <span>
          {snapshots.filter(s => ['auto_reconciled', 'manual_reconciled'].includes(s.reconciliationStatus)).length} reconciled
        </span>
        <span>
          {snapshots.filter(s => s.reconciliationStatus === 'pending').length} pending
        </span>
        <span>
          {snapshots.filter(s => s.reconciliationStatus === 'discrepancy').length} discrepancies
        </span>
      </div>
    </div>
  );
}
