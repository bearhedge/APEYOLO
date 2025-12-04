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
// Market Status Card
// ============================================

function MarketStatusCard({
  marketStatus,
  today,
  upcomingEvents,
}: {
  marketStatus: { isOpen: boolean; currentTimeET: string; marketCloseET: string; reason: string } | null;
  today: string;
  upcomingEvents: MarketEvent[];
}) {
  if (!marketStatus) {
    return (
      <div className="bg-charcoal rounded-2xl p-6 border border-white/10 animate-pulse">
        <div className="h-6 bg-white/10 rounded w-1/3 mb-4" />
        <div className="h-4 bg-white/10 rounded w-2/3" />
      </div>
    );
  }

  const nextHoliday = upcomingEvents.find(e => e.type === 'holiday');
  const nextEarlyClose = upcomingEvents.find(e => e.type === 'early_close');

  return (
    <div className="bg-charcoal rounded-2xl p-6 border border-white/10">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Market Status</h2>
          <p className="text-silver text-sm">{today}</p>
        </div>
        <div className={cn(
          'px-3 py-1 rounded-full text-sm font-medium',
          marketStatus.isOpen
            ? 'bg-green-500/20 text-green-400'
            : 'bg-red-500/20 text-red-400'
        )}>
          {marketStatus.isOpen ? 'Market Open' : 'Market Closed'}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div>
          <p className="text-silver text-xs uppercase tracking-wider">Current Time (ET)</p>
          <p className="text-lg font-mono">{marketStatus.currentTimeET}</p>
        </div>
        <div>
          <p className="text-silver text-xs uppercase tracking-wider">Market Close</p>
          <p className="text-lg font-mono">{marketStatus.marketCloseET}</p>
        </div>
        <div className="col-span-2">
          <p className="text-silver text-xs uppercase tracking-wider">Status</p>
          <p className="text-sm">{marketStatus.reason}</p>
        </div>
      </div>

      {(nextHoliday || nextEarlyClose) && (
        <div className="border-t border-white/10 pt-4 mt-4">
          <p className="text-silver text-xs uppercase tracking-wider mb-2">Upcoming Events</p>
          <div className="space-y-1">
            {nextHoliday && (
              <p className="text-sm">
                <span className="text-red-400">{nextHoliday.date}</span>
                <span className="text-silver mx-2">-</span>
                <span>{nextHoliday.event}</span>
              </p>
            )}
            {nextEarlyClose && (
              <p className="text-sm">
                <span className="text-yellow-400">{nextEarlyClose.date}</span>
                <span className="text-silver mx-2">-</span>
                <span>{nextEarlyClose.event}</span>
              </p>
            )}
          </div>
        </div>
      )}
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
  const [forceRun, setForceRun] = useState(false);

  const handleRun = async (jobId: string) => {
    setRunningJobId(jobId);
    try {
      await onRun(jobId, { forceRun, skipMarketCheck: forceRun });
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
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Scheduled Jobs</h2>
        <label className="flex items-center gap-2 text-sm text-silver">
          <input
            type="checkbox"
            checked={forceRun}
            onChange={(e) => setForceRun(e.target.checked)}
            className="rounded border-white/20 bg-white/5"
          />
          Force run (skip checks)
        </label>
      </div>

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
                  <code className="text-xs bg-white/10 px-2 py-1 rounded">
                    {job.schedule}
                  </code>
                  <p className="text-silver text-xs mt-1">{job.timezone}</p>
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
    marketStatus,
    upcomingEvents,
    today,
    isLoading,
    error,
    runJob,
    toggleJob,
    isRunning,
    isToggling,
    refetch,
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
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-wide">Jobs</h1>
            <p className="text-silver text-sm mt-1">Scheduled tasks and execution pipeline</p>
          </div>
          <button
            onClick={refetch}
            className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium transition-colors"
          >
            Refresh
          </button>
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
            {/* Market Status Card */}
            <MarketStatusCard
              marketStatus={marketStatus}
              today={today}
              upcomingEvents={upcomingEvents}
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
