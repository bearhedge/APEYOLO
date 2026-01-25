/**
 * Jobs Page - Terminal aesthetic job scheduler view
 *
 * Simple 4-column table: JOB NAME | SCHEDULE | STATUS | TOGGLE
 */

import { useJobs, type Job } from '@/hooks/useJobs';
import { LeftNav } from '@/components/LeftNav';

// ============================================
// Parse cron expression to human-readable format
// ============================================

function parseCronToHuman(cron: string): string {
  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Handle common patterns
  if (dayOfWeek === '1-5' && dayOfMonth === '*' && month === '*') {
    // Weekday schedule
    const hourNum = parseInt(hour);
    const minuteNum = parseInt(minute);
    const ampm = hourNum >= 12 ? 'PM' : 'AM';
    const hour12 = hourNum === 0 ? 12 : hourNum > 12 ? hourNum - 12 : hourNum;
    const minuteStr = minuteNum.toString().padStart(2, '0');
    return `Weekdays ${hour12}:${minuteStr} ${ampm} ET`;
  }

  if (dayOfWeek === '*' && dayOfMonth !== '*') {
    // Specific day of month
    return `Day ${dayOfMonth} at ${hour}:${minute.padStart(2, '0')}`;
  }

  // Default: show hour:minute
  const hourNum = parseInt(hour);
  const minuteNum = parseInt(minute);
  if (!isNaN(hourNum) && !isNaN(minuteNum)) {
    const ampm = hourNum >= 12 ? 'PM' : 'AM';
    const hour12 = hourNum === 0 ? 12 : hourNum > 12 ? hourNum - 12 : hourNum;
    return `${hour12}:${minuteNum.toString().padStart(2, '0')} ${ampm} ET`;
  }

  return cron;
}

// ============================================
// Status indicator (terminal style dot)
// ============================================

function StatusDot({ status }: { status: string | null }) {
  const color = status === 'success' ? '#4ade80' :
                status === 'failed' ? '#ef4444' :
                status === 'running' ? '#3b82f6' :
                '#888';

  const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Pending';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor: color,
        display: 'inline-block',
      }} />
      <span style={{ color: '#888', fontSize: '13px' }}>{label}</span>
    </div>
  );
}

// ============================================
// Toggle switch (terminal style)
// ============================================

function Toggle({
  enabled,
  onToggle,
  disabled,
}: {
  enabled: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      style={{
        width: '36px',
        height: '18px',
        borderRadius: '9px',
        backgroundColor: enabled ? '#4ade80' : '#333',
        border: '1px solid #444',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        position: 'relative',
        transition: 'background-color 0.2s',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: '2px',
          left: enabled ? '18px' : '2px',
          width: '12px',
          height: '12px',
          borderRadius: '50%',
          backgroundColor: '#fff',
          transition: 'left 0.2s',
        }}
      />
    </button>
  );
}

// ============================================
// Jobs Table (terminal aesthetic)
// ============================================

function JobsTable({
  jobs,
  onToggle,
  isToggling,
}: {
  jobs: Job[];
  onToggle: (jobId: string, enabled: boolean) => Promise<void>;
  isToggling: boolean;
}) {
  const tableStyle: React.CSSProperties = {
    width: '100%',
    borderCollapse: 'collapse',
    fontFamily: '"IBM Plex Mono", monospace',
    fontSize: '13px',
  };

  const thStyle: React.CSSProperties = {
    textAlign: 'left',
    padding: '12px 16px',
    borderBottom: '1px solid #333',
    color: '#888',
    fontWeight: 500,
    textTransform: 'uppercase',
    fontSize: '11px',
    letterSpacing: '0.05em',
  };

  const tdStyle: React.CSSProperties = {
    padding: '12px 16px',
    borderBottom: '1px solid #222',
    color: '#e5e5e5',
  };

  if (jobs.length === 0) {
    return (
      <div style={{ color: '#888', padding: '24px', textAlign: 'center' }}>
        No jobs configured
      </div>
    );
  }

  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyle}>Job Name</th>
          <th style={thStyle}>Schedule</th>
          <th style={thStyle}>Status</th>
          <th style={{ ...thStyle, textAlign: 'center' }}>Toggle</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => (
          <tr key={job.id} style={{ transition: 'background-color 0.1s' }}>
            <td style={tdStyle}>
              <div style={{ fontWeight: 500 }}>{job.name}</div>
              {job.description && (
                <div style={{ color: '#666', fontSize: '12px', marginTop: '2px' }}>
                  {job.description}
                </div>
              )}
            </td>
            <td style={{ ...tdStyle, color: '#888' }}>
              {parseCronToHuman(job.schedule)}
            </td>
            <td style={tdStyle}>
              <StatusDot status={job.lastRunStatus} />
            </td>
            <td style={{ ...tdStyle, textAlign: 'center' }}>
              <Toggle
                enabled={job.enabled}
                onToggle={() => onToggle(job.id, !job.enabled)}
                disabled={isToggling}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ============================================
// Main Jobs Page
// ============================================

interface JobsProps {
  hideLeftNav?: boolean;
}

export function Jobs({ hideLeftNav = false }: JobsProps) {
  const {
    jobs,
    isLoading,
    error,
    toggleJob,
    isToggling,
  } = useJobs();

  const handleToggle = async (jobId: string, enabled: boolean) => {
    try {
      await toggleJob(jobId, enabled);
    } catch (err) {
      console.error('Failed to toggle job:', err);
    }
  };

  const containerStyle: React.CSSProperties = {
    height: '100%',
    backgroundColor: '#0a0a0a',
    fontFamily: '"IBM Plex Mono", monospace',
    color: '#e5e5e5',
    overflow: 'auto',
  };

  const contentStyle: React.CSSProperties = {
    padding: '24px',
    maxWidth: '900px',
  };

  const headerStyle: React.CSSProperties = {
    marginBottom: '24px',
  };

  const titleStyle: React.CSSProperties = {
    fontSize: '14px',
    fontWeight: 500,
    color: '#888',
    marginBottom: '4px',
  };

  const tableContainerStyle: React.CSSProperties = {
    border: '1px solid #333',
    borderRadius: '4px',
    overflow: 'hidden',
  };

  // When embedded in window, don't show LeftNav
  if (hideLeftNav) {
    return (
      <div style={containerStyle}>
        <div style={contentStyle}>
          <div style={headerStyle}>
            <div style={titleStyle}>$ crontab -l</div>
          </div>

          {error && (
            <div style={{ color: '#ef4444', marginBottom: '16px', fontSize: '13px' }}>
              Error: {String(error)}
            </div>
          )}

          {isLoading ? (
            <div style={{ color: '#888', fontSize: '13px' }}>Loading...</div>
          ) : (
            <div style={tableContainerStyle}>
              <JobsTable
                jobs={jobs}
                onToggle={handleToggle}
                isToggling={isToggling}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  // Full page with LeftNav
  return (
    <div className="flex h-[calc(100vh-64px)]">
      <LeftNav />
      <div style={containerStyle}>
        <div style={contentStyle}>
          <div style={headerStyle}>
            <h1 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '4px' }}>Jobs</h1>
            <div style={titleStyle}>$ crontab -l</div>
          </div>

          {error && (
            <div style={{ color: '#ef4444', marginBottom: '16px', fontSize: '13px' }}>
              Error: {String(error)}
            </div>
          )}

          {isLoading ? (
            <div style={{ color: '#888', fontSize: '13px' }}>Loading...</div>
          ) : (
            <div style={tableContainerStyle}>
              <JobsTable
                jobs={jobs}
                onToggle={handleToggle}
                isToggling={isToggling}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
