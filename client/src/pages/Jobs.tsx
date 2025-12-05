import { useState } from 'react';
import { LeftNav } from '@/components/LeftNav';
import { useJobs, type Job, type JobRun, type MarketEvent } from '@/hooks/useJobs';
import { cn } from '@/lib/utils';

// ============================================
// Status Badge Component
// ============================================

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    success: 'bg-green-500/20 text-green-400 border-green-500/30',
    failed: 'bg-red-500/20 text-red-400 border-red-500/30',
    running: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    skipped: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    pending: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  };

  return (
    <span className={cn(
      'px-2 py-0.5 text-xs font-medium rounded-full border',
      styles[status] || styles.pending
    )}>
      {status}
    </span>
  );
}

// ============================================
// Impact Badge Component
// ============================================

function ImpactBadge({ level }: { level?: 'low' | 'medium' | 'high' | 'critical' }) {
  if (!level) return null;

  const styles: Record<string, string> = {
    critical: 'bg-red-500/30 text-red-400 border-red-500/50 animate-pulse',
    high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    low: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  };

  return (
    <span className={cn(
      'px-1.5 py-0.5 text-[10px] font-medium rounded border uppercase tracking-wider',
      styles[level]
    )}>
      {level}
    </span>
  );
}

// ============================================
// Event Type Badge Component
// ============================================

function EventTypeBadge({ type }: { type: 'holiday' | 'early_close' | 'economic' }) {
  const styles: Record<string, { bg: string; text: string; label: string }> = {
    holiday: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Holiday' },
    early_close: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Early Close' },
    economic: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'Economic' },
  };

  const style = styles[type] || styles.economic;

  return (
    <span className={cn(
      'px-1.5 py-0.5 text-[10px] font-medium rounded uppercase tracking-wider',
      style.bg,
      style.text
    )}>
      {style.label}
    </span>
  );
}

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
// Market Events Card
// ============================================

function MarketEventsCard({
  upcomingEvents,
  today,
}: {
  upcomingEvents: MarketEvent[];
  today: string;
}) {
  if (upcomingEvents.length === 0) {
    return (
      <div className="bg-charcoal rounded-2xl p-6 border border-white/10">
        <h2 className="text-lg font-semibold mb-4">Market Events</h2>
        <p className="text-silver text-sm">No upcoming market events</p>
      </div>
    );
  }

  // Check if there's a high-impact event today
  const todayHighImpactEvents = upcomingEvents.filter(
    e => e.date === today && (e.impactLevel === 'critical' || e.impactLevel === 'high')
  );

  return (
    <div className="bg-charcoal rounded-2xl p-6 border border-white/10">
      {/* High-impact event alert banner */}
      {todayHighImpactEvents.length > 0 && (
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-lg p-3 mb-4 flex items-center gap-2">
          <span className="text-orange-400 text-lg">!</span>
          <div>
            <p className="text-orange-400 font-medium text-sm">High-Impact Event Today</p>
            <p className="text-orange-300/80 text-xs">
              {todayHighImpactEvents.map(e => e.event).join(', ')}
              {todayHighImpactEvents[0]?.time && ` at ${todayHighImpactEvents[0].time} ET`}
            </p>
          </div>
        </div>
      )}

      <h2 className="text-lg font-semibold mb-4">Market Events</h2>

      <div className="space-y-2">
        {upcomingEvents.slice(0, 8).map((event, i) => (
          <div key={i} className="flex items-center gap-4 text-sm py-1.5 border-b border-white/5 last:border-0">
            <span className="font-mono text-zinc-400 w-24 flex-shrink-0">{event.date}</span>
            <span className="w-20 flex-shrink-0">
              <EventTypeBadge type={event.type} />
            </span>
            <span className="w-16 flex-shrink-0">
              <ImpactBadge level={event.impactLevel} />
            </span>
            <span className="flex-1 truncate">{event.event}</span>
            {event.time && (
              <span className="text-silver text-xs flex-shrink-0">{event.time} ET</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// Jobs Table
// ============================================

function JobsTable({
  jobs,
  onRun,
  onToggle,
  isRunning,
  isToggling,
}: {
  jobs: Job[];
  onRun: (jobId: string, options?: { forceRun?: boolean; skipMarketCheck?: boolean }) => Promise<void>;
  onToggle: (jobId: string, enabled: boolean) => Promise<void>;
  isRunning: boolean;
  isToggling: boolean;
}) {
  const [runningJobId, setRunningJobId] = useState<string | null>(null);

  const handleRun = async (jobId: string) => {
    setRunningJobId(jobId);
    try {
      await onRun(jobId);
    } finally {
      setRunningJobId(null);
    }
  };

  if (jobs.length === 0) {
    return (
      <div className="bg-charcoal rounded-2xl p-6 border border-white/10">
        <h2 className="text-lg font-semibold mb-4">Scheduled Jobs</h2>
        <div className="text-center py-8">
          <p className="text-silver">No jobs configured</p>
          <p className="text-silver text-sm mt-1">Jobs will appear here once configured</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-charcoal rounded-2xl p-6 border border-white/10">
      <h2 className="text-lg font-semibold mb-4">Scheduled Jobs</h2>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left py-3 px-2 text-silver font-medium">Job</th>
              <th className="text-left py-3 px-2 text-silver font-medium">Schedule</th>
              <th className="text-left py-3 px-2 text-silver font-medium">Last Run</th>
              <th className="text-left py-3 px-2 text-silver font-medium">Status</th>
              <th className="text-center py-3 px-2 text-silver font-medium">Enabled</th>
              <th className="text-right py-3 px-2 text-silver font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={job.id} className="border-b border-white/5 hover:bg-white/5">
                <td className="py-3 px-2">
                  <div>
                    <p className="font-medium">{job.name}</p>
                    <p className="text-silver text-xs">{job.description}</p>
                  </div>
                </td>
                <td className="py-3 px-2">
                  <p className="text-sm font-medium">
                    {parseCronToHuman(job.schedule)}
                  </p>
                  <code className="text-xs text-zinc-500">{job.schedule}</code>
                </td>
                <td className="py-3 px-2">
                  {job.lastRunAt ? (
                    <div>
                      <p className="font-mono text-xs">
                        {new Date(job.lastRunAt).toLocaleString()}
                      </p>
                      {job.latestRun?.durationMs && (
                        <p className="text-silver text-xs">
                          {(job.latestRun.durationMs / 1000).toFixed(1)}s
                        </p>
                      )}
                    </div>
                  ) : (
                    <span className="text-silver">Never</span>
                  )}
                </td>
                <td className="py-3 px-2">
                  {job.lastRunStatus ? (
                    <StatusBadge status={job.lastRunStatus} />
                  ) : (
                    <StatusBadge status="pending" />
                  )}
                </td>
                <td className="py-3 px-2 text-center">
                  <button
                    onClick={() => onToggle(job.id, !job.enabled)}
                    disabled={isToggling}
                    className={cn(
                      'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                      job.enabled ? 'bg-electric' : 'bg-white/20',
                      isToggling && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    <span
                      className={cn(
                        'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                        job.enabled ? 'translate-x-6' : 'translate-x-1'
                      )}
                    />
                  </button>
                </td>
                <td className="py-3 px-2 text-right">
                  <button
                    onClick={() => handleRun(job.id)}
                    disabled={isRunning || runningJobId === job.id}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                      'bg-electric/20 text-electric hover:bg-electric/30',
                      (isRunning || runningJobId === job.id) && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    {runningJobId === job.id ? 'Running...' : 'Run Now'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================
// Run History Table
// ============================================

function RunHistoryTable({ history }: { history: JobRun[] }) {
  if (history.length === 0) {
    return (
      <div className="bg-charcoal rounded-2xl p-6 border border-white/10">
        <h2 className="text-lg font-semibold mb-4">Run History</h2>
        <div className="text-center py-8">
          <p className="text-silver">No job runs yet</p>
          <p className="text-silver text-sm mt-1">Execution history will appear here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-charcoal rounded-2xl p-6 border border-white/10">
      <h2 className="text-lg font-semibold mb-4">Run History</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left py-3 px-2 text-silver font-medium">Job ID</th>
              <th className="text-left py-3 px-2 text-silver font-medium">Started</th>
              <th className="text-left py-3 px-2 text-silver font-medium">Duration</th>
              <th className="text-left py-3 px-2 text-silver font-medium">Triggered By</th>
              <th className="text-left py-3 px-2 text-silver font-medium">Status</th>
              <th className="text-left py-3 px-2 text-silver font-medium">Result/Error</th>
            </tr>
          </thead>
          <tbody>
            {history.map((run) => (
              <tr key={run.id} className="border-b border-white/5 hover:bg-white/5">
                <td className="py-3 px-2">
                  <code className="text-xs">{run.jobId}</code>
                </td>
                <td className="py-3 px-2 font-mono text-xs">
                  {new Date(run.startedAt).toLocaleString()}
                </td>
                <td className="py-3 px-2 font-mono text-xs">
                  {run.durationMs ? `${(run.durationMs / 1000).toFixed(2)}s` : '—'}
                </td>
                <td className="py-3 px-2">
                  <span className={cn(
                    'px-2 py-0.5 text-xs rounded-full',
                    run.triggeredBy === 'scheduler'
                      ? 'bg-purple-500/20 text-purple-400'
                      : 'bg-blue-500/20 text-blue-400'
                  )}>
                    {run.triggeredBy}
                  </span>
                </td>
                <td className="py-3 px-2">
                  <StatusBadge status={run.status} />
                </td>
                <td className="py-3 px-2 max-w-xs">
                  {run.error ? (
                    <span className="text-red-400 text-xs truncate block" title={run.error}>
                      {run.error}
                    </span>
                  ) : run.result ? (
                    <span className="text-green-400 text-xs truncate block" title={JSON.stringify(run.result)}>
                      {typeof run.result === 'object' && 'snapshotId' in run.result
                        ? `Snapshot: ${(run.result as { snapshotId?: string }).snapshotId?.slice(0, 8)}...`
                        : typeof run.result === 'object' && 'reason' in run.result
                          ? (run.result as { reason?: string }).reason
                          : 'Success'}
                    </span>
                  ) : (
                    <span className="text-silver text-xs">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================
// Main Jobs Page
// ============================================

export function Jobs() {
  const {
    jobs,
    history,
    upcomingEvents,
    today,
    isLoading,
    error,
    runJob,
    toggleJob,
    isRunning,
    isToggling,
  } = useJobs();

  const handleRun = async (jobId: string, options?: { forceRun?: boolean; skipMarketCheck?: boolean }) => {
    try {
      await runJob(jobId, options);
    } catch (err) {
      console.error('Failed to run job:', err);
    }
  };

  const handleToggle = async (jobId: string, enabled: boolean) => {
    try {
      await toggleJob(jobId, enabled);
    } catch (err) {
      console.error('Failed to toggle job:', err);
    }
  };

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <LeftNav />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-wide">Jobs</h1>
          <p className="text-silver text-sm mt-1">Scheduled tasks and execution pipeline</p>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-500/20 border border-red-500/30 rounded-xl p-4">
            <p className="text-red-400 font-medium">Error loading jobs</p>
            <p className="text-red-400/80 text-sm mt-1">{String(error)}</p>
          </div>
        )}

        {/* Loading State */}
        {isLoading && !jobs.length && (
          <div className="space-y-6">
            <div className="bg-charcoal rounded-2xl p-6 border border-white/10 animate-pulse">
              <div className="h-6 bg-white/10 rounded w-1/3 mb-4" />
              <div className="h-4 bg-white/10 rounded w-2/3" />
            </div>
            <div className="bg-charcoal rounded-2xl p-6 border border-white/10 animate-pulse">
              <div className="h-6 bg-white/10 rounded w-1/4 mb-4" />
              <div className="space-y-3">
                <div className="h-10 bg-white/10 rounded" />
                <div className="h-10 bg-white/10 rounded" />
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        {!isLoading && (
          <>
            {/* Market Events Card */}
            <MarketEventsCard
              upcomingEvents={upcomingEvents}
              today={today}
            />

            {/* Jobs Table */}
            <JobsTable
              jobs={jobs}
              onRun={handleRun}
              onToggle={handleToggle}
              isRunning={isRunning}
              isToggling={isToggling}
            />

            {/* Run History */}
            <RunHistoryTable history={history} />
          </>
        )}
      </div>
    </div>
  );
}
